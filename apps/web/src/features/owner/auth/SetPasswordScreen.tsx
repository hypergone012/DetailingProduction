import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { supabase } from '../api/client'
import { AuthLayout } from './AuthLayout'
import { useSession } from './session'

export function SetPasswordScreen() {
  const { finishRecovery, session } = useSession()
  const id = useId()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return setError('Не короче 8 символов')
    if (password !== repeat) return setError('Пароли не совпадают')
    setBusy(true)
    setError(null)
    const { error: err } = await supabase().auth.updateUser({ password })
    setBusy(false)
    if (err) return setError(/same/i.test(err.message) ? 'Новый пароль совпадает со старым' : 'Не удалось сохранить пароль. Попробуйте ещё раз')
    // Remove the one-time tokens from the address bar.
    window.history.replaceState(window.history.state, '', window.location.pathname)
    finishRecovery()
  }

  return (
    <AuthLayout title="Новый пароль" text={session?.user.email ? `Для ${session.user.email}` : undefined}>
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Field id={`${id}-p1`} label="Пароль" hint="Минимум 8 символов">
          <Input id={`${id}-p1`} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field id={`${id}-p2`} label="Ещё раз">
          <Input id={`${id}-p2`} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" block loading={busy}>
          Сохранить и войти
        </Button>
      </form>
    </AuthLayout>
  )
}
