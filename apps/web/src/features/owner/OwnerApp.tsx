import { RefreshCw } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { StatusScreen } from '@/app/StatusScreen'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api/http'
import { MotionProvider } from '@/motion/MotionProvider'
import { TenantHead } from '@/tenant/TenantHead'
import { useTenant } from '@/tenant/TenantProvider'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { LoginScreen } from './auth/LoginScreen'
import { NoAccess } from './auth/NoAccess'
import { SessionProvider, useSession } from './auth/session'
import { SetPasswordScreen } from './auth/SetPasswordScreen'
import { OwnerContext, useMembership, type OwnerContextValue } from './data'
import { OwnerNav } from './layout/OwnerNav'

const load = {
  today: () => import('./today/TodayScreen'),
  calendar: () => import('./calendar/CalendarScreen'),
  customers: () => import('./customers/CustomersScreen'),
  customer: () => import('./customers/CustomerScreen'),
  services: () => import('./services/ServicesScreen'),
  schedule: () => import('./schedule/ScheduleScreen'),
  settings: () => import('./settings/SettingsScreen'),
  sheets: () => import('./calendar/OwnerSheets'),
  assistant: () => import('./assistant/OwnerAssistant'),
}
const TodayScreen = lazy(() => load.today().then((m) => ({ default: m.TodayScreen })))
const CalendarScreen = lazy(() => load.calendar().then((m) => ({ default: m.CalendarScreen })))
const CustomersScreen = lazy(() => load.customers().then((m) => ({ default: m.CustomersScreen })))
const CustomerScreen = lazy(() => load.customer().then((m) => ({ default: m.CustomerScreen })))
const ServicesScreen = lazy(() => load.services().then((m) => ({ default: m.ServicesScreen })))
const ScheduleScreen = lazy(() => load.schedule().then((m) => ({ default: m.ScheduleScreen })))
const SettingsScreen = lazy(() => load.settings().then((m) => ({ default: m.SettingsScreen })))
const OwnerSheets = lazy(() => load.sheets().then((m) => ({ default: m.OwnerSheets })))
const OwnerAssistant = lazy(() => load.assistant().then((m) => ({ default: m.OwnerAssistant })))

/** Owner cabinet of one studio: /s/:slug/owner/* (Supabase Auth, studio membership required). */
export function OwnerApp() {
  const { slug, data } = useTenant()
  return (
    <ThemeProvider storageKey={`${slug}:owner`} branding={data.branding}>
      <MotionProvider>
        <TenantHead data={data} app="owner" />
        <SessionProvider>
          <OwnerGate />
        </SessionProvider>
      </MotionProvider>
    </ThemeProvider>
  )
}

function Splash() {
  return (
    <div className="mx-auto grid max-w-xl gap-3 px-4 pt-[calc(var(--dp-safe-top)+24px)]" aria-busy="true" aria-label="Загрузка">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-28 rounded-2xl" />
    </div>
  )
}

function OwnerGate() {
  const { session, ready, recovery } = useSession()
  const { slug, data } = useTenant()
  const membership = useMembership(data.tenant.id, session?.user.id)
  const value = useMemo<OwnerContextValue | null>(() => {
    if (!session || !membership.data) return null
    const role = membership.data
    return {
      tenantId: data.tenant.id,
      slug,
      role,
      userId: session.user.id,
      email: session.user.email ?? '',
      tz: data.tenant.timezone,
      locale: data.tenant.locale,
      currency: data.tenant.currency,
      canManage: role === 'owner' || role === 'manager',
      isOwner: role === 'owner',
    }
  }, [session, membership.data, data.tenant, slug])

  if (!ready) return <Splash />
  if (!session) return <LoginScreen />
  if (recovery) return <SetPasswordScreen />
  if (membership.isPending) return <Splash />
  if (membership.isError)
    return (
      <StatusScreen title="Не удалось открыть кабинет" text={errorMessage(membership.error)}>
        <Button onClick={() => membership.refetch()} loading={membership.isFetching}>
          <RefreshCw /> Повторить
        </Button>
      </StatusScreen>
    )
  if (!value) return <NoAccess />
  return (
    <OwnerContext.Provider value={value}>
      <OwnerShell />
    </OwnerContext.Provider>
  )
}

function usePrefetch() {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200))
    const handle = idle(() => Object.values(load).forEach((l) => void l().catch(() => undefined)))
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(handle as number)
  }, [])
}

/** Loaded on the first ?chat=1 and kept mounted (close animation, follow-up actions). */
function AssistantMount() {
  const { data } = useTenant()
  const location = useLocation()
  const [loaded, setLoaded] = useState(false)
  if (!loaded && new URLSearchParams(location.search).get('chat') === '1') setLoaded(true)
  if (!loaded || data.features.ai === false) return null
  return (
    <Suspense fallback={null}>
      <OwnerAssistant />
    </Suspense>
  )
}

function OwnerShell() {
  usePrefetch()
  const { slug } = useTenant()
  return (
    <>
      <main className="min-h-dvh pb-[calc(var(--dp-nav-height)+var(--dp-safe-bottom)+8px)] md:pb-8 md:pl-[88px]">
        <Suspense fallback={<Splash />}>
          <Routes>
            <Route path="owner" element={<TodayScreen />} />
            <Route path="owner/calendar" element={<CalendarScreen />} />
            <Route path="owner/customers" element={<CustomersScreen />} />
            <Route path="owner/customers/:id" element={<CustomerScreen />} />
            <Route path="owner/services" element={<ServicesScreen />} />
            <Route path="owner/schedule" element={<ScheduleScreen />} />
            <Route path="owner/settings" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to={`/s/${slug}/owner`} replace />} />
          </Routes>
        </Suspense>
      </main>
      <OwnerNav />
      <Suspense fallback={null}>
        <OwnerSheets />
      </Suspense>
      <AssistantMount />
    </>
  )
}
