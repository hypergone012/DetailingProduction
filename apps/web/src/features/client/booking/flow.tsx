import type { CreateBookingResponse, Slot, VehicleInput } from '@dp/core/api/contracts'
import type { BodyType } from '@dp/core/tenant/constants'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { storage } from '@/lib/storage'
import { useTenant } from '@/tenant/TenantProvider'

export type Step = 'service' | 'vehicle' | 'slot' | 'confirm' | 'done'

export type VehicleChoice =
  | { kind: 'saved'; id: string; body_type: BodyType; label: string }
  | { kind: 'new'; data: VehicleInput }

export interface Draft {
  serviceId: string | null
  vehicle: VehicleChoice | null
  addonIds: string[]
  slot: Slot | null
  result: CreateBookingResponse | null
}

const EMPTY: Draft = { serviceId: null, vehicle: null, addonIds: [], slot: null, result: null }

export interface StartOptions {
  serviceId?: string
  vehicle?: VehicleChoice
  addonIds?: string[]
  /** A concrete free slot (e.g. picked in the assistant chat). */
  slot?: Slot
}

interface FlowValue {
  step: Step | null
  draft: Draft
  bodyType: BodyType | null
  start: (o?: StartOptions) => void
  go: (s: Step) => void
  back: () => void
  close: () => void
  /** Closes the flow, then opens `path` (after the step entries were popped from history). */
  closeTo: (path: string) => void
  update: (patch: Partial<Draft>) => void
  finish: (r: CreateBookingResponse) => void
}

const FlowContext = createContext<FlowValue | null>(null)

function historyIdx(): number {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' ? idx : 0
}
const PARAM = 'book'
const STEPS: Step[] = ['service', 'vehicle', 'slot', 'confirm', 'done']

/**
 * Booking flow state. The current step lives in the URL (?book=<step>), so the system Back
 * button walks back through the steps and a closed sheet leaves no trace in history.
 * The draft survives a reload (local storage, per studio) until the booking is created.
 */
export function BookingFlowProvider({ children }: { children: ReactNode }) {
  const { slug } = useTenant()
  const navigate = useNavigate()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const raw = params.get(PARAM)
  const urlStep = raw && (STEPS as string[]).includes(raw) ? (raw as Step) : null
  const [draft, setDraft] = useState<Draft>(() => storage.getJson<Draft>(`${slug}:draft`, EMPTY))
  // History index where the flow started (React Router keeps `idx` in history.state).
  // Closing walks back to it, so the steps never stay in history — also after system Back.
  const startIdx = useRef<number | null>(null)
  const doneSeen = useRef(false)
  const after = useRef<string | null>(null)

  useEffect(() => {
    if (draft.result) storage.remove(`${slug}:draft`)
    else storage.setJson(`${slug}:draft`, draft)
  }, [draft, slug])

  // Read the URL at call time: callbacks may run after a navigation (e.g. from the assistant).
  const withStep = useCallback((s: Step | null) => {
    const p = new URLSearchParams(window.location.search)
    if (s) p.set(PARAM, s)
    else p.delete(PARAM)
    const q = p.toString()
    return `${window.location.pathname}${q ? `?${q}` : ''}`
  }, [])

  const go = useCallback((s: Step) => navigate(withStep(s)), [navigate, withStep])

  const close = useCallback(() => {
    const steps = startIdx.current === null ? 0 : historyIdx() - startIdx.current
    startIdx.current = null
    if (steps > 0) navigate(-steps)
    else navigate(withStep(null), { replace: true })
    setDraft((d) => (d.result ? EMPTY : d))
  }, [navigate, withStep])

  const closeTo = useCallback(
    (path: string) => {
      after.current = path
      close()
    },
    [close],
  )

  // history.go() is asynchronous: open the follow-up page once the steps are gone.
  useEffect(() => {
    if (urlStep || !after.current) return
    const path = after.current
    after.current = null
    navigate(path)
  }, [urlStep, location.key, navigate])

  const back = useCallback(() => {
    if (startIdx.current !== null && historyIdx() - startIdx.current > 1) navigate(-1)
    else close()
  }, [navigate, close])

  const start = useCallback(
    (o: StartOptions = {}) => {
      setDraft({ ...EMPTY, serviceId: o.serviceId ?? null, vehicle: o.vehicle ?? null, addonIds: o.addonIds ?? [], slot: o.slot ?? null })
      startIdx.current = historyIdx()
      doneSeen.current = false
      go(!o.serviceId ? 'service' : !o.vehicle ? 'vehicle' : o.slot ? 'confirm' : 'slot')
    },
    [go],
  )

  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), [])

  const finish = useCallback(
    (r: CreateBookingResponse) => {
      setDraft((d) => ({ ...d, result: r }))
      // Replace "confirm" with "done": Back never returns to a form that was already sent.
      navigate(withStep('done'), { replace: true })
    },
    [navigate, withStep],
  )

  // Once the result screen was shown, leaving it for another step (e.g. system Back) closes the
  // flow: the request was already sent. The URL changes after the draft, so wait for "done" first.
  useEffect(() => {
    if (!draft.result) return
    if (urlStep === 'done') doneSeen.current = true
    else if (doneSeen.current && urlStep) {
      doneSeen.current = false
      close()
    }
  }, [draft.result, urlStep, close])

  const bodyType = draft.vehicle ? (draft.vehicle.kind === 'saved' ? draft.vehicle.body_type : draft.vehicle.data.body_type) : null
  const value = useMemo<FlowValue>(
    () => ({ step: urlStep, draft, bodyType, start, go, back, close, closeTo, update, finish }),
    [urlStep, draft, bodyType, start, go, back, close, closeTo, update, finish],
  )
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>
}

export function useBookingFlow(): FlowValue {
  const ctx = useContext(FlowContext)
  if (!ctx) throw new Error('useBookingFlow outside BookingFlowProvider')
  return ctx
}
