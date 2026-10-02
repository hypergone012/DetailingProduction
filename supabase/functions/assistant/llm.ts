/**
 * LLM tool loop (Anthropic Messages API through the official SDK).
 *
 * - LLM_BASE_URL must point to an Anthropic Messages API compatible endpoint (the Anthropic
 *   API itself or a gateway in front of it); credentials never leave this function.
 * - History from the client is plain text only (no thinking or tool blocks are replayed),
 *   so every request starts an append-only conversation: the loop appends each assistant
 *   response unchanged and answers its tool calls in one user message.
 * - Bounded: at most MAX_STEPS model calls per request; every call's tokens are recorded
 *   against the studio's daily budget (api_ai_record_tokens) as soon as it returns.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { AssistantAction, ToolScope } from '../_vendor/core/ai/tools.ts'
import { parseToolCall, toolsForScope } from '../_vendor/core/ai/tools.ts'
import { HttpError } from '../_shared/http.ts'
import { execute, type Scope } from './executors.ts'

export const MAX_STEPS = 6

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface LlmResult {
  reply: string
  actions: AssistantAction[]
  tokens: number
  steps: number
}

/** The SDK appends /v1/messages itself; accept LLM_BASE_URL with or without /v1. */
export function sdkBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
}

// Models that take output_config.effort and the server-side refusal fallback.
const EFFORT_MODELS = /^claude-(opus-(4-[5-9]|5)|sonnet-(5|4-6)|fable-5)/
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5$|sonnet-5-5)/

export async function runLlm(
  cfg: LlmConfig,
  scope: Scope,
  system: { stable: string; volatile: string },
  history: { role: 'user' | 'assistant'; text: string }[],
  onTokens: (n: number) => Promise<void>,
): Promise<LlmResult> {
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: sdkBaseUrl(cfg.baseUrl), maxRetries: 1, timeout: 25_000 })
  const toolScope: ToolScope = scope.kind
  const tools: Anthropic.Beta.BetaTool[] = toolsForScope(toolScope).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema,
    strict: true,
  }))
  const firstParty = new URL(sdkBaseUrl(cfg.baseUrl)).hostname === 'api.anthropic.com'
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.text }))
  const actions: AssistantAction[] = []
  let tokens = 0
  let lastText = ''

  for (let step = 1; step <= MAX_STEPS; step++) {
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model: cfg.model,
      max_tokens: 4096,
      system: [
        { type: 'text', text: system.stable, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: system.volatile },
      ],
      tools,
      messages,
    }
    if (EFFORT_MODELS.test(cfg.model)) params.output_config = { effort: scope.kind === 'client' ? 'low' : 'medium' }
    if (firstParty && FALLBACK_MODELS.test(cfg.model)) {
      // A policy decline is retried server-side on a fallback model (Claude API only).
      params.betas = ['server-side-fallback-2026-07-01']
      params.fallbacks = 'default'
    }
    const response = await client.beta.messages.create(params)

    const u = response.usage
    const used = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    tokens += used
    await onTokens(used)

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (text) lastText = text

    if (response.stop_reason === 'refusal') {
      return { reply: 'Не могу помочь с этим вопросом. Спросите, пожалуйста, об услугах, ценах или записи.', actions, tokens, steps: step }
    }
    if (response.stop_reason !== 'tool_use') {
      return { reply: lastText || 'Готово.', actions, tokens, steps: step }
    }

    messages.push({ role: 'assistant', content: response.content })
    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const parsed = parseToolCall(call.name, call.input, toolScope)
        if (!parsed.ok) return { type: 'tool_result', tool_use_id: call.id, content: parsed.error, is_error: true }
        try {
          const out = await execute(scope, parsed.name, parsed.input)
          actions.push(...out.actions)
          return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out.result) }
        } catch (e) {
          const message = e instanceof HttpError ? e.message : 'Внутренняя ошибка инструмента'
          if (!(e instanceof HttpError)) console.error(`[assistant tool ${parsed.name}]`, e instanceof Error ? e.message : e)
          return { type: 'tool_result', tool_use_id: call.id, content: message, is_error: true }
        }
      }),
    )
    // All results of one turn go back in a single user message.
    messages.push({ role: 'user', content: results })
  }
  return { reply: lastText || 'Не удалось завершить ответ. Попробуйте переформулировать вопрос.', actions, tokens, steps: MAX_STEPS }
}
