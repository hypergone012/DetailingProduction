import { useEffect } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { looksLikeToken } from '@dp/core/crypto'
import { device } from '@/lib/device'
import { useTenant } from '@/tenant/TenantProvider'

/**
 * /s/:slug/b/:id#t=<token> — a link from the studio. The token is kept on this device and
 * removed from the address bar (fragments are never sent to servers or in Referer).
 */
export function TokenLanding() {
  const { id } = useParams()
  const { slug } = useTenant()
  const navigate = useNavigate()
  const token = new URLSearchParams(window.location.hash.slice(1)).get('t')
  useEffect(() => {
    if (id && looksLikeToken(token)) device.setBookingToken(slug, id, token)
    navigate(`/s/${slug}/history/${id ?? ''}`, { replace: true })
  }, [id, token, slug, navigate])
  if (!id) return <Navigate to={`/s/${slug}`} replace />
  return null
}
