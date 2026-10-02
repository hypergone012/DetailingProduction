import { BottomSheet } from '@astryxdesign/core/BottomSheet'
import type { AssistantAction } from '@dp/core/ai/tools'
import { useNavigate } from 'react-router'
import { AssistantChat } from '@/components/assistant/AssistantChat'
import { SheetFrame } from '@/components/SheetFrame'
import { dayKey } from '@/lib/format'
import { useTenant } from '@/tenant/TenantProvider'
import { useBookingFlow, type VehicleChoice } from '../booking/flow'
import { useProfile } from '../data'
import { useChatParam } from '@/components/assistant/chatParam'

/** Client assistant: questions about the studio, prices and free time; booking stays a tap away. */
export function AssistantSheet() {
  const chat = useChatParam()
  const { slug, api, data, tz } = useTenant()
  const flow = useBookingFlow()
  const navigate = useNavigate()
  const { profile } = useProfile()

  const onAction = async (a: AssistantAction) => {
    if (a.type === 'book') {
      // Re-read the slot from the live availability (its end time and that it is still free).
      const day = dayKey(a.starts_at, tz)
      const v = profile?.vehicles.find((x) => !a.body_type || x.body_type === a.body_type) ?? null
      const avail = await api.availability({ serviceId: a.service_id, bodyType: a.body_type ?? v?.body_type ?? null, from: day, days: 1 }).catch(() => null)
      const slot = avail?.slots.find((s) => new Date(s.starts_at).getTime() === new Date(a.starts_at).getTime())
      const vehicle: VehicleChoice | undefined = v ? { kind: 'saved', id: v.id, body_type: v.body_type, label: v.nickname || `${v.make} ${v.model}` } : undefined
      chat.close(() => flow.start({ serviceId: a.service_id, vehicle, slot }))
      return
    }
    if (a.type === 'open_booking') return chat.close(() => navigate(`/s/${slug}/history/${a.booking_id}`))
    if (a.type === 'open_url') window.open(a.url, '_blank', 'noopener')
    if (a.type === 'call') window.location.href = `tel:${a.phone}`
  }

  return (
    <BottomSheet isOpen={chat.open} onOpenChange={(o) => !o && chat.close()} label="Помощник" height="tall" purpose="form">
      {chat.open && (
        <SheetFrame title="Помощник" onClose={() => chat.close()}>
          <AssistantChat
            storageKey={`${slug}:assistant:client`}
            intro={`Здравствуйте! Я помощник «${data.tenant.name}». Подскажу цены и свободное время и помогу записаться.`}
            suggestions={['Что свободно завтра?', ...(data.services[0] ? [`Сколько стоит «${data.services[0].name}»?`] : []), 'Где вы находитесь?', 'Когда я записан?']}
            send={api.assistant}
            onAction={onAction}
          />
        </SheetFrame>
      )}
    </BottomSheet>
  )
}
