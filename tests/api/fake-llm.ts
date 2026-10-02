/**
 * TEST DOUBLE — not an integration. A scripted stand-in for the Anthropic Messages API so
 * the assistant's own logic (tool loop, scopes, validation, budgets, fallback) can be tested
 * without credentials. It returns pre-programmed responses in order and records every
 * request it receives. A real model call is a separate check, reported in ACCEPTANCE.md as
 * NOT RUN while LLM_API_KEY is absent.
 *
 *   POST /__script    { responses: [<message JSON> | { status, error }] }  (also clears the log)
 *   GET  /__requests  -> recorded requests (headers + body)
 *   POST /v1/messages -> next scripted response
 */
import { createServer, type Server } from 'node:http'

export interface RecordedRequest {
  path: string
  headers: Record<string, string | string[] | undefined>
  body: Record<string, unknown>
}

export function startFakeLlm(port: number): Promise<Server> {
  let queue: unknown[] = []
  let log: RecordedRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json', 'request-id': `req_fake_${Date.now()}` })
        res.end(JSON.stringify(data))
      }
      const url = new URL(req.url ?? '/', 'http://x')
      if (req.method === 'POST' && url.pathname === '/__script') {
        queue = (JSON.parse(raw) as { responses: unknown[] }).responses
        log = []
        return send(200, { ok: true })
      }
      if (req.method === 'GET' && url.pathname === '/__requests') return send(200, log)
      if (req.method === 'POST' && url.pathname === '/v1/messages') {
        log.push({ path: req.url ?? '', headers: req.headers, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} })
        const next = queue.shift() as { status?: number; error?: unknown } | undefined
        if (!next) return send(500, { type: 'error', error: { type: 'api_error', message: 'fake: script exhausted' } })
        if (next.status) return send(next.status, { type: 'error', error: next.error ?? { type: 'api_error', message: 'fake error' } })
        return send(200, { id: `msg_fake_${log.length}`, type: 'message', role: 'assistant', model: 'fake', stop_sequence: null, ...next })
      }
      send(404, { type: 'error', error: { type: 'not_found_error', message: 'fake: unknown path' } })
    })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}
