import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useTenant } from '@/tenant/TenantProvider'
import { AuthLayout } from './AuthLayout'
import { useSession } from './session'

export function NoAccess() {
  const { session, signOut } = useSession()
  const { slug, data } = useTenant()
  return (
    <AuthLayout title="Нет доступа" text={`Аккаунт ${session?.user.email ?? ''} не подключён к кабинету «${data.tenant.name}». Попросите владельца студии добавить вас.`}>
      <Button size="lg" block onClick={() => void signOut()}>
        Войти другим аккаунтом
      </Button>
      <Button variant="ghost" asChild>
        <Link to={`/s/${slug}`}>Страница записи</Link>
      </Button>
    </AuthLayout>
  )
}
