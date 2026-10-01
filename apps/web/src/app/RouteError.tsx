import { RefreshCw, TriangleAlert } from 'lucide-react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'
import { StatusScreen } from './StatusScreen'

export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  // Chunk load failure after a deploy: a reload fetches the new build.
  const stale = error instanceof Error && /dynamically imported module|Failed to fetch|Importing a module script failed/i.test(error.message)
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
