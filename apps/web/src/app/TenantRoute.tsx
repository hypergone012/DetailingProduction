import { RefreshCw, SearchX, WifiOff } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api/http'
import { TenantProvider, useTenantBootstrap } from '@/tenant/TenantProvider'
import { StatusScreen } from './StatusScreen'

const loadClient = () => import('@/features/client/ClientApp')
const loadOwner = () => import('@/features/owner/OwnerApp')
const ClientApp = lazy(() => loadClient().then((m) => ({ default: m.ClientApp })))
const OwnerApp = lazy(() => loadOwner().then((m) => ({ default: m.OwnerApp })))

function isOwnerPath(rest: string): boolean {
  return rest === 'owner' || rest.startsWith('owner/')
}

/** Resolves the studio from /s/:slug once; client and owner apps render inside it. */
export function TenantRoute() {
  const params = useParams()
  const slug = (params.slug ?? '').toLowerCase()
  const owner = isOwnerPath(params['*'] ?? '')
  // Fetch the app code in parallel with the studio data instead of after it.
  void (owner ? loadOwner() : loadClient()).catch(() => undefined)
  const q = useTenantBootstrap(slug, owner)
  if (q.isPending) return <TenantSplash />
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404
    return notFound ? (
      <StatusScreen icon={<SearchX />} title="Студия не найдена" text="Ссылка устарела или студия больше не принимает онлайн-записи." />
    ) : (
      <StatusScreen icon={<WifiOff />} title="Нет соединения" text="Не удалось загрузить студию. Проверьте интернет и попробуйте ещё раз.">
        <Button onClick={() => q.refetch()} loading={q.isFetching}>
          <RefreshCw /> Повторить
        </Button>
      </StatusScreen>
    )
  }
  return (
    <TenantProvider slug={slug} data={q.data}>
      <Suspense fallback={<TenantSplash />}>{owner ? <OwnerApp /> : <ClientApp />}</Suspense>
    </TenantProvider>
  )
}

function TenantSplash() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 pt-[calc(var(--dp-safe-top)+20px)]" aria-busy="true" aria-label="Загрузка">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="aspect-[16/10] w-full rounded-2xl" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}
