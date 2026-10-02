import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { clearPrivateCaches } from '@/pwa/register'
import { supabase } from '../api/client'

interface SessionValue {
  session: Session | null
  ready: boolean
  /** The user arrived through a password recovery / invite link and must set a password. */
  recovery: boolean
  finishRecovery: () => void
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  // Read before supabase-js consumes the hash.
  const [recovery, setRecovery] = useState(() => /[#&]type=(recovery|invite)\b/.test(window.location.hash))

  useEffect(() => {
    const auth = supabase().auth
    let alive = true
    void auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setReady(true)
    })
    const { data } = auth.onAuthStateChange((event, s) => {
      setSession(s)
      setReady(true)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') qc.removeQueries({ queryKey: ['owner'] })
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [qc])

  const signOut = useCallback(async () => {
    await supabase().auth.signOut({ scope: 'local' })
    // Nothing of the cabinet may survive on this device after logout.
    qc.removeQueries({ queryKey: ['owner'] })
    clearPrivateCaches()
  }, [qc])

  const value = useMemo(() => ({ session, ready, recovery, finishRecovery: () => setRecovery(false), signOut }), [session, ready, recovery, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession outside SessionProvider')
  return ctx
}
