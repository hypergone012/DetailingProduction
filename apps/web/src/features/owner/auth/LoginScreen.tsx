import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { useTenant } from '@/tenant/TenantProvider'
import { supabase } from '../api/client'
import { AuthLayout } from './AuthLayout'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function LoginScreen() {
  const { slug } = useTenant()
  const id = useId()
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const emailOk = EMAIL_RE.test(email.trim())

  const login = async (e: FormEvent) => {
    e.preventDefault()
    if (!emailOk || !password) return setError('Введите email и пароль')
    setBusy(true)
    setError(null)
    const { error: err } = await supabase().auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (err) setError(/invalid/i.test(err.message) ? 'Неверный email или пароль' : /fetch|network/i.test(err.message) ? 'Нет соединения с сервером' : 'Не удалось войти. Попробуйте ещё раз')
  }

  const forgot = async (e: FormEvent) => {
    e.preventDefault()
    if (!emailOk) return setError('Введите email, на который зарегистрирован кабинет')
    setBusy(true)
    setError(null)
    const { error: err } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/s/${slug}/owner/` })
    setBusy(false)
    // The server answers the same for unknown addresses; a real error means mail is not configured.
    if (err) setError('Не удалось отправить письмо. Обратитесь к администратору платформы за ссылкой для входа.')
    else setSent(true)
  }

  if (mode === 'forgot') {
    return (
      <AuthLayout title="Восстановление пароля" text="Пришлём ссылку для установки нового пароля.">
        {sent ? (
          <p className="rounded-xl bg-sunken p-3 text-sm">Если этот email зарегистрирован, письмо со ссылкой уже отправлено. Проверьте почту.</p>
        ) : (
          <form className="grid gap-4" onSubmit={forgot} noValidate>
            <Field id={`${id}-email`} label="Email">
              <Input id={`${id}-email`} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" size="lg" block loading={busy}>
              Отправить ссылку
            </Button>
          </form>
        )}
        <Button variant="ghost" onClick={() => (setMode('login'), setError(null), setSent(false))}>
          Вернуться ко входу
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Вход" text="Для владельца и сотрудников студии.">
      <form className="grid gap-4" onSubmit={login} noValidate>
        <Field id={`${id}-email`} label="Email">
          <Input id={`${id}-email`} type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id={`${id}-password`} label="Пароль">
          <Input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" block loading={busy}>
          Войти
        </Button>
      </form>
      <div className="flex items-center justify-between gap-2 text-sm">
        <button type="button" className="text-accent-text underline-offset-4 hover:underline" onClick={() => (setMode('forgot'), setError(null))}>
          Забыли пароль?
        </button>
        <Link to={`/s/${slug}`} className="text-fg-muted underline-offset-4 hover:underline">
          Страница записи
        </Link>
      </div>
    </AuthLayout>
  )
}
