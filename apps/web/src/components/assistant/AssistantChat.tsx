import type { AssistantAction, ChatResponse } from '@dp/core/ai/tools'
import { ArrowUp, Bot, CalendarCheck, ExternalLink, Phone, RotateCcw, UserRound } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api/http'
import { session } from '@/lib/storage'
import { cn } from '@/lib/utils'

interface Turn {
  role: 'user' | 'assistant'
  text: string
  actions?: AssistantAction[]
  notice?: ChatResponse['notice']
}

const NOTICE: Record<NonNullable<ChatResponse['notice']>, string> = {
  not_configured: 'Быстрые ответы: умный помощник не подключён, отвечаю по шаблонам.',
  budget_exhausted: 'Лимит умного помощника на сегодня исчерпан — отвечаю по шаблонам.',
  unavailable: 'Умный помощник сейчас недоступен — отвечаю по шаблонам.',
  disabled: 'Умный помощник отключён студией — отвечаю по шаблонам.',
}

const HISTORY_TURNS = 12

/**
 * Chat with the studio assistant. The conversation lives in sessionStorage only (gone when
 * the tab closes, cleared on logout) and is sent back as plain text; actions are buttons
 * the person presses — the assistant never books or changes anything by itself.
 */
export function AssistantChat({
  storageKey,
  intro,
  suggestions,
  send,
  onAction,
}: {
  storageKey: string
  intro: string
  suggestions: string[]
  send: (messages: { role: 'user' | 'assistant'; text: string }[]) => Promise<ChatResponse>
  onAction: (a: AssistantAction) => void | Promise<void>
}) {
  const [turns, setTurns] = useState<Turn[]>(() => {
    try {
      return JSON.parse(session.get(storageKey) ?? '[]') as Turn[]
    } catch {
      return []
    }
  })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    session.set(storageKey, JSON.stringify(turns.slice(-40)))
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [turns, storageKey])

  const ask = async (question: string, base = turns) => {
    const q = question.trim()
    if (!q || busy) return
    const next: Turn[] = [...base, { role: 'user', text: q }]
    setTurns(next)
    setText('')
    setBusy(true)
    setError(null)
    try {
      const r = await send(next.slice(-HISTORY_TURNS).map((t) => ({ role: t.role, text: t.text.slice(0, 2000) })))
      setTurns([...next, { role: 'assistant', text: r.reply, actions: r.actions, notice: r.notice }])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const retry = () => {
    const lastUser = [...turns].reverse().find((t) => t.role === 'user')
    if (!lastUser) return
    void ask(lastUser.text, turns.slice(0, turns.lastIndexOf(lastUser)))
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void ask(text)
    }
  }

  return (
    <div className="flex min-h-[60dvh] flex-col">
      <div className="flex-1 space-y-3 px-4 pb-4" aria-live="polite">
        <Bubble role="assistant" text={intro} />
        {turns.map((t, i) => (
          <div key={i} className="grid min-w-0 gap-2">
            <Bubble role={t.role} text={t.text} />
            {t.notice && <p className="pl-10 text-xs text-fg-subtle">{NOTICE[t.notice]}</p>}
            {t.actions && t.actions.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-10">
                {t.actions.map((a, j) => (
                  <Button key={j} size="sm" className="h-auto min-h-9 max-w-full py-1.5 text-left whitespace-normal" variant={a.type === 'book' ? 'primary' : 'secondary'} disabled={busy} onClick={() => (a.type === 'reply' ? void ask(a.text) : void onAction(a))}>
                    <ActionIcon a={a} /> {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 pl-10 text-sm text-fg-muted">
            <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden /> Думаю…
          </p>
        )}
        {error && (
          <div className="flex items-center gap-2 pl-10 text-sm text-danger" role="alert">
            {error}
            <Button size="sm" variant="ghost" onClick={retry}>
              <RotateCcw /> Повторить
            </Button>
          </div>
        )}
        {turns.length === 0 && (
          <div className="flex flex-wrap gap-2 pl-10">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => void ask(s)} className="pressable rounded-full border border-line bg-bg-elevated px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="sticky bottom-0 flex items-end gap-2 border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+var(--dp-safe-bottom))]"
        onSubmit={(e) => {
          e.preventDefault()
          void ask(text)
        }}
      >
        <Textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1} maxLength={2000} placeholder="Спросите о записи или ценах" aria-label="Сообщение помощнику" className="max-h-32 min-h-11 flex-1 resize-none" />
        <Button type="submit" size="icon" aria-label="Отправить" disabled={!text.trim() || busy}>
          <ArrowUp />
        </Button>
      </form>
      {turns.length > 0 && (
        <Button variant="link" size="sm" className="mx-auto mb-2" onClick={() => (setTurns([]), setError(null))}>
          Начать заново
        </Button>
      )}
    </div>
  )
}

function Bubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const mine = role === 'user'
  return (
    <div className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}>
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', mine ? 'bg-surface-2' : 'bg-accent-subtle text-accent-text')} aria-hidden>
        {mine ? <UserRound className="size-4" /> : <Bot className="size-4" />}
      </span>
      <p className={cn('max-w-[80%] min-w-0 rounded-2xl px-3.5 py-2.5 text-[15px] break-words whitespace-pre-wrap', mine ? 'rounded-br-md bg-accent text-accent-fg' : 'rounded-bl-md bg-surface-2')}>{text}</p>
    </div>
  )
}

function ActionIcon({ a }: { a: AssistantAction }) {
  if (a.type === 'book') return <CalendarCheck />
  if (a.type === 'call') return <Phone />
  if (a.type === 'open_url') return <ExternalLink />
  return null
}
