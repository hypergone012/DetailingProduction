import { CarFront } from 'lucide-react'
import { StatusScreen } from './StatusScreen'

/** The bare domain belongs to no studio: clients always arrive through a studio link (/s/<studio>). */
export function RootPage() {
  return (
    <StatusScreen
      icon={<CarFront />}
      title="Онлайн-запись в детейлинг-студию"
      text="Откройте ссылку вашей студии — её можно найти в сообщении или на сайте студии."
    />
  )
}
