import { Download, Share, SquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useInstall } from '@/lib/install'

export function InstallCard({ name }: { name: string }) {
  const { state, install } = useInstall()
  if (state === 'installed' || state === 'unavailable') return null
  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent-text">
          <Download className="size-5" aria-hidden />
        </span>
        <div className="grid gap-1 text-sm">
          <p className="font-medium">Приложение {name}</p>
          <p className="text-fg-muted">Запись в одно касание с главного экрана, работает и без интернета для просмотра студии.</p>
        </div>
      </div>
      {state === 'prompt' ? (
        <Button variant="subtle" onClick={() => void install()}>
          Установить
        </Button>
      ) : (
        <ol className="grid gap-1.5 rounded-xl bg-sunken p-3 text-sm text-fg-muted">
          <li className="flex items-center gap-2">
            <Share className="size-4" aria-hidden /> Нажмите «Поделиться» в Safari
          </li>
          <li className="flex items-center gap-2">
            <SquarePlus className="size-4" aria-hidden /> Выберите «На экран „Домой“»
          </li>
        </ol>
      )}
    </div>
  )
}
