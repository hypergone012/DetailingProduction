import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { MotionProvider } from '@/motion/MotionProvider'
import { TenantHead } from '@/tenant/TenantHead'
import { useTenant } from '@/tenant/TenantProvider'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { useReturnFocus } from '@/lib/focus'
import { BookingFlowProvider, useBookingFlow } from './booking/flow'
import { HomeScreen } from './home/HomeScreen'
import { BottomNav } from './layout/BottomNav'
import { SiteFooter } from './layout/SiteFooter'
import { TopNav } from './layout/TopNav'
import { ScreenTransition } from './layout/ScreenTransition'

// Home renders from the first chunk; everything else (and the sheets) loads on demand and is
// prefetched while the browser is idle, so navigation still feels instant.
const load = {
  services: () => import('./services/ServicesScreen'),
  serviceDetail: () => import('./services/ServiceDetailScreen'),
  garage: () => import('./garage/GarageScreen'),
  vehicle: () => import('./garage/VehicleDetailScreen'),
  history: () => import('./history/HistoryScreen'),
  booking: () => import('./history/BookingDetailScreen'),
  token: () => import('./history/TokenLanding'),
  profile: () => import('./profile/ProfileScreen'),
  sheets: () => import('./booking/BookingSheets'),
  assistant: () => import('./assistant/AssistantSheet'),
}
const loadUpdate = () => import('./layout/UpdatePrompt')
const ServicesScreen = lazy(() => load.services().then((m) => ({ default: m.ServicesScreen })))
const ServiceDetailScreen = lazy(() => load.serviceDetail().then((m) => ({ default: m.ServiceDetailScreen })))
const GarageScreen = lazy(() => load.garage().then((m) => ({ default: m.GarageScreen })))
const VehicleDetailScreen = lazy(() => load.vehicle().then((m) => ({ default: m.VehicleDetailScreen })))
const HistoryScreen = lazy(() => load.history().then((m) => ({ default: m.HistoryScreen })))
const BookingDetailScreen = lazy(() => load.booking().then((m) => ({ default: m.BookingDetailScreen })))
const TokenLanding = lazy(() => load.token().then((m) => ({ default: m.TokenLanding })))
const ProfileScreen = lazy(() => load.profile().then((m) => ({ default: m.ProfileScreen })))
const BookingSheets = lazy(() => load.sheets().then((m) => ({ default: m.BookingSheets })))
const UpdatePrompt = lazy(() => loadUpdate().then((m) => ({ default: m.UpdatePrompt })))
const AssistantSheet = lazy(() => load.assistant().then((m) => ({ default: m.AssistantSheet })))

/** Cursor position inside `.spotlight` cards, for their hover light (mouse devices only). */
function useSpotlight() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const move = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('.spotlight') as HTMLElement | null
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    document.addEventListener('pointermove', move, { passive: true })
    return () => document.removeEventListener('pointermove', move)
  }, [])
}

/**
 * Prefetches the other screens once the page has fully loaded (cover photo included) and the
 * browser is idle, so it never competes with the first screen. Skipped with Data Saver.
 */
function usePrefetch() {
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    if (connection?.saveData) return
    let handle = 0
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200))
    const start = () => {
      handle = idle(() => Object.values(load).forEach((l) => void l().catch(() => undefined)), { timeout: 4000 }) as number
    }
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    return () => {
      window.removeEventListener('load', start)
      ;(window.cancelIdleCallback ?? window.clearTimeout)(handle)
    }
  }, [])
}

/** The update toast's code loads only when a new version is actually waiting. */
function Update() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const on = () => setReady(true)
    window.addEventListener('dp:update-ready', on)
    return () => window.removeEventListener('dp:update-ready', on)
  }, [])
  if (!ready) return null
  return (
    <Suspense fallback={null}>
      <UpdatePrompt />
    </Suspense>
  )
}

function ScreenFallback() {
  return (
    <div className="mx-auto grid max-w-xl md:max-w-2xl gap-3 px-4 pt-[calc(var(--dp-safe-top)+64px)] lg:max-w-[1440px] lg:px-8" aria-busy="true">
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-24 rounded-2xl" />
    </div>
  )
}

/** Mounts the booking sheets only once a flow starts (their code is not needed before). */
function Sheets() {
  const flow = useBookingFlow()
  useReturnFocus(Boolean(flow.step))
  if (!flow.step) return null
  return (
    <Suspense fallback={null}>
      <BookingSheets />
    </Suspense>
  )
}

/** Loaded on the first ?chat=1 and kept mounted, so its close animation and follow-ups run. */
function Assistant() {
  const { data } = useTenant()
  const location = useLocation()
  const [loaded, setLoaded] = useState(false)
  if (!loaded && new URLSearchParams(location.search).get('chat') === '1') setLoaded(true)
  if (!loaded || data.features.ai === false) return null
  return (
    <Suspense fallback={null}>
      <AssistantSheet />
    </Suspense>
  )
}

/** Client app of one studio: /s/:slug/* (no registration). */
export function ClientApp() {
  const { slug, data } = useTenant()
  usePrefetch()
  useSpotlight()
  return (
    <ThemeProvider storageKey={`${slug}:client`} branding={data.branding}>
      <MotionProvider>
        <TenantHead data={data} app="client" />
        <BookingFlowProvider>
          <div className="dp-aurora" aria-hidden />
          <TopNav />
          <main className="relative z-[1] min-h-dvh pb-[calc(var(--dp-nav-height)+var(--dp-safe-bottom)+8px)] md:pt-16 md:pb-12 md:[--dp-header-offset:4rem] lg:min-h-[calc(100dvh-200px)] lg:pt-[72px] lg:pb-0 lg:[--dp-header-offset:72px]">
            <ScreenTransition>
              <Suspense fallback={<ScreenFallback />}>
                <Routes>
                  <Route index element={<HomeScreen />} />
                  <Route path="services" element={<ServicesScreen />} />
                  <Route path="services/:id" element={<ServiceDetailScreen />} />
                  <Route path="garage" element={<GarageScreen />} />
                  <Route path="garage/:id" element={<VehicleDetailScreen />} />
                  <Route path="history" element={<HistoryScreen />} />
                  <Route path="history/:id" element={<BookingDetailScreen />} />
                  <Route path="b/:id" element={<TokenLanding />} />
                  <Route path="profile" element={<ProfileScreen />} />
                  <Route path="*" element={<Navigate to={`/s/${slug}`} replace />} />
                </Routes>
              </Suspense>
            </ScreenTransition>
          </main>
          <SiteFooter />
          <BottomNav />
          <Sheets />
          <Assistant />
          <Update />
        </BookingFlowProvider>
      </MotionProvider>
    </ThemeProvider>
  )
}
