import { BottomSheet } from '@astryxdesign/core/BottomSheet'
import type { AssistantAction, ChatResponse } from '@dp/core/ai/tools'
import { useNavigate } from 'react-router'
import { AssistantChat } from '@/components/assistant/AssistantChat'
import { useChatParam } from '@/components/assistant/chatParam'
import { SheetFrame } from '@/components/SheetFrame'
import { authedFunction } from '../api/client'
import { useOwner } from '../data'
import { useSheets } from '../shared/sheets'

/** Staff assistant: reads schedule, customers and statistics; changes stay in the cabinet's buttons. */
export function OwnerAssistant() {
  const chat = useChatParam()
  const { slug } = useOwner()
  const sheets = useSheets()
  const navigate = useNavigate()
  const send = (messages: { role: 'user' | 'assistant'; text: string }[]) =>
    authedFunction<ChatResponse>(`/assistant/t/${encodeURIComponent(slug)}/chat`, { method: 'POST', json: { scope: 'owner', messages }, timeoutMs: 60_000 })

  const onAction = (a: AssistantAction) => {
    if (a.type === 'open_booking') chat.close(() => sheets.open({ booking: a.booking_id }))
    else if (a.type === 'open_customer') chat.close(() => navigate(`/s/${slug}/owner/customers/${a.customer_id}`))
    else if (a.type === 'open_url') window.open(a.url, '_blank', 'noopener')
    else if (a.type === 'call') window.location.href = `tel:${a.phone}`
  }

  return (
    <BottomSheet isOpen={chat.open} onOpenChange={(o) => !o && chat.close()} label="Помощник" height="tall" purpose="form">
      {chat.open && (
        <SheetFrame title="Помощник" onClose={() => chat.close()}>
          <AssistantChat
            storageKey={`${slug}:assistant:owner`}
            intro="Спросите про расписание, свободные окна, клиентов или статистику. Изменения делаются кнопками кабинета."
            suggestions={['Кто записан завтра?', 'Что ждёт подтверждения?', 'Выручка за неделю', 'Свободные окна в субботу']}
            send={send}
            onAction={onAction}
          />
        </SheetFrame>
      )}
    </BottomSheet>
  )
}
