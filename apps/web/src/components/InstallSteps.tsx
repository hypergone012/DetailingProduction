import { EllipsisVertical, MonitorDown, Share, SquarePlus } from 'lucide-react'
import type { ReactNode } from 'react'
import { isIOS } from '@/lib/push'

export type InstallPlatform = 'ios' | 'android' | 'desktop'

/** The platform whose steps to show first on this device. */
export function currentPlatform(): InstallPlatform {
  if (isIOS()) return 'ios'
  return window.matchMedia('(pointer: coarse)').matches ? 'android' : 'desktop'
}

const STEPS: Record<InstallPlatform, { title: string; steps: { icon: ReactNode; text: ReactNode }[] }> = {
  ios: {
    title: 'iPhone и iPad',
    steps: [
      { icon: <Share />, text: <>Откройте сайт в Safari и нажмите «Поделиться»</> },
      { icon: <SquarePlus />, text: <>Выберите «На экран „Домой“» → «Добавить»</> },
    ],
  },
  android: {
    title: 'Android',
    steps: [
      { icon: <EllipsisVertical />, text: <>В Chrome или Яндекс Браузере откройте меню (три точки)</> },
      { icon: <SquarePlus />, text: <>«Установить приложение» или «Добавить на главный экран»</> },
    ],
  },
  desktop: {
    title: 'Компьютер',
    steps: [
      { icon: <MonitorDown />, text: <>Chrome, Edge, Яндекс Браузер: значок установки справа в адресной строке или меню → «Установить»</> },
      { icon: <SquarePlus />, text: <>Safari на Mac: «Файл» → «Добавить в Dock»</> },
    ],
  },
}

/** How to put the site on the home screen / desktop as an app, per platform. */
export function InstallSteps({ platforms }: { platforms: InstallPlatform[] }) {
  return (
    <div className="grid gap-3">
      {platforms.map((p) => (
        <div key={p} className="grid gap-1.5">
          {platforms.length > 1 && <p className="text-sm font-medium">{STEPS[p].title}</p>}
          <ol className="grid gap-1.5 rounded-xl bg-sunken p-3 text-sm text-fg-muted">
            {STEPS[p].steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
                {s.icon}
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}
