import { Download } from 'lucide-react'
import { currentPlatform, InstallSteps } from '@/components/InstallSteps'
import { Button } from '@/components/ui/button'
import { useInstall } from '@/lib/install'

/**
 * "Install the app": the browser's own prompt where it offers one (Chrome, Edge, Android),
 * otherwise the manual steps for this device (Safari on iPhone, Firefox, Samsung Internet...).
 */
export function InstallCard({ name }: { name: string }) {
  const { state, install } = useInstall()
  if (state === 'installed') return null
  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent-text">
          <Download className="size-5" aria-hidden />
        </span>
        <div className="grid gap-1 text-sm">
          <p className="font-medium">Приложение {name}</p>
          <p className="text-fg-muted">Иконка на главном экране и запись в одно касание. Это тот же сайт: ничего скачивать из магазина не нужно.</p>
        </div>
      </div>
      {state === 'prompt' ? (
        <Button variant="subtle" onClick={() => void install()}>
          Установить
        </Button>
      ) : (
        <InstallSteps platforms={[currentPlatform()]} />
      )}
    </div>
  )
}
