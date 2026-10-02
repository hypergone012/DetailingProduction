import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'

/**
 * Cabinet sheets live in the URL (?booking=<id>, ?new=booking&day=…), so they survive a
 * reload, can be linked to, and the system Back button closes them. A sheet opened inside
 * the app is closed by going back; a deep-linked one by replacing the URL.
 */
const SHEET_KEYS = ['booking', 'block', 'new', 'day', 'time', 'resource', 'customer', 'move']

export function useSheets() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()

  const open = useCallback(
    (values: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(location.search)
      for (const k of SHEET_KEYS) next.delete(k)
      for (const [k, v] of Object.entries(values)) if (v) next.set(k, v)
      const depth = ((location.state as { sheetDepth?: number } | null)?.sheetDepth ?? 0) + 1
      navigate({ pathname: location.pathname, search: next.toString() }, { state: { sheetDepth: depth } })
    },
    [location.pathname, location.search, location.state, navigate],
  )

  const close = useCallback(() => {
    const depth = (location.state as { sheetDepth?: number } | null)?.sheetDepth ?? 0
    if (depth > 0) {
      navigate(-depth)
      return
    }
    const next = new URLSearchParams(location.search)
    for (const k of SHEET_KEYS) next.delete(k)
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true })
  }, [location.pathname, location.search, location.state, navigate])

  /** Replace the current sheet by another one (no extra history entry). */
  const replace = useCallback(
    (values: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(location.search)
      for (const k of SHEET_KEYS) next.delete(k)
      for (const [k, v] of Object.entries(values)) if (v) next.set(k, v)
      navigate({ pathname: location.pathname, search: next.toString() }, { replace: true, state: location.state })
    },
    [location.pathname, location.search, location.state, navigate],
  )

  return {
    bookingId: params.get('booking'),
    blockId: params.get('block'),
    create: params.get('new') as 'booking' | 'block' | null,
    move: params.get('move') === '1',
    day: params.get('day'),
    time: params.get('time'),
    resource: params.get('resource'),
    customer: params.get('customer'),
    open,
    close,
    replace,
  }
}
