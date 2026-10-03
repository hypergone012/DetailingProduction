import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'
import { isStaleBuildError, reloadForNewBuild } from '@/pwa/chunk-recovery'
import { StatusScreen } from './StatusScreen'

export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  // Chunk load failure after a deploy: a reload fetches the new build (once by itself).
  const stale = isStaleBuildError(error)
  useEffect(() => {
    if (stale) reloadForNewBuild()
  }, [stale])
  return (
    <StatusScreen
      icon={<TriangleAlert />}
      title={notFound ? 'Страница не найдена' : stale ? 'Доступна новая версия' : 'Что-то пошло не так'}
      text={notFound ? 'Проверьте ссылку или вернитесь на главную студии.' : 'Обновите страницу — данные не потеряются.'}
    >
      <Button onClick={() => window.location.reload()}>
        <RefreshCw /> Обновить
      </Button>
    </StatusScreen>
  )
}
