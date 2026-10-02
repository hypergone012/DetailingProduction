import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'

/** The assistant sheet lives in the URL (?chat=1): system Back closes it. */
export function useChatParam() {
  const location = useLocation()
  const navigate = useNavigate()
  const open = new URLSearchParams(location.search).get('chat') === '1'
  const after = useRef<(() => void) | null>(null)

  // history.back() is asynchronous: run the follow-up once the sheet is really closed.
  useEffect(() => {
    if (open || !after.current) return
    const f = after.current
    after.current = null
    f()
  }, [open, location.key])

  const show = useCallback(() => {
    const p = new URLSearchParams(window.location.search)
    p.set('chat', '1')
    navigate({ pathname: window.location.pathname, search: p.toString() }, { state: { chat: true } })
  }, [navigate])

  const close = useCallback(
    (then?: () => void) => {
      after.current = then ?? null
      if ((window.history.state as { usr?: { chat?: boolean } } | null)?.usr?.chat) {
        navigate(-1)
        return
      }
      const p = new URLSearchParams(window.location.search)
      p.delete('chat')
      navigate({ pathname: window.location.pathname, search: p.toString() }, { replace: true })
    },
    [navigate],
  )
  return { open, show, close }
}
