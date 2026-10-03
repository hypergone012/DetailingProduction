import { useToast } from '@astryxdesign/core/Toast'
import { Copy, Download, ExternalLink, Share2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { InstallSteps } from '@/components/InstallSteps'
import { Card, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { qrPath, qrPng } from '@/lib/qr'
import { useTenant } from '@/tenant/TenantProvider'
import { useOwner } from '../data'

/**
 * The studio's client link, its QR code (to print at the reception or send), and how clients
 * and staff put the site on their phone or computer as an app.
 */
export function ShareSection() {
  const { slug } = useOwner()
  const { data } = useTenant()
  const showToast = useToast()
  const clientUrl = `${window.location.origin}/s/${slug}/`
  const ownerUrl = `${window.location.origin}/s/${slug}/owner/`
  const qr = useMemo(() => qrPath(clientUrl), [clientUrl])
  const [busy, setBusy] = useState(false)
  const name = data.tenant.name

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast({ body: 'Ссылка скопирована' })
    } catch {
      showToast({ body: 'Не удалось скопировать: выделите ссылку и скопируйте вручную' })
    }
  }

  const share = async () => {
    try {
      await navigator.share({ title: name, text: `Онлайн-запись в ${name}`, url: clientUrl })
    } catch {
      // Closing the share sheet is not an error.
    }
  }

  const download = async () => {
    setBusy(true)
    try {
      const blob = await qrPng(clientUrl, name)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `qr-${slug}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Ссылка для клиентов">
      <Card id="share" className="grid scroll-mt-20 gap-5 p-4 sm:grid-cols-[200px_1fr]">
        <svg viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label={`QR-код ссылки ${clientUrl}`} className="mx-auto w-48 rounded-xl sm:w-full">
          <rect width={qr.size} height={qr.size} fill="#fff" />
          <path d={qr.d} fill="#000" />
        </svg>
        <div className="grid content-start gap-3">
          <p className="text-sm text-fg-muted">По этой ссылке клиенты записываются онлайн. Распечатайте QR-код на стойку или отправьте ссылку в мессенджер. Сайт сразу работает в браузере, а установить его как приложение можно по желанию.</p>
          <a href={clientUrl} target="_blank" rel="noreferrer" className="break-all rounded-xl bg-sunken px-3 py-2.5 font-medium text-accent-text outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {clientUrl}
          </a>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void copy(clientUrl)}>
              <Copy /> Скопировать
            </Button>
            {'share' in navigator && (
              <Button size="sm" variant="secondary" onClick={() => void share()}>
                <Share2 /> Поделиться
              </Button>
            )}
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void download()}>
              <Download /> Скачать QR (PNG)
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <a href={clientUrl} target="_blank" rel="noreferrer">
                <ExternalLink /> Открыть
              </a>
            </Button>
          </div>
        </div>
      </Card>
      <Card className="grid gap-4 p-4">
        <div className="grid gap-1">
          <p className="font-medium">Как установить как приложение</p>
          <p className="text-sm text-fg-muted">
            Подходит и клиентам (ссылка выше), и вам: кабинет ставится отдельным приложением по адресу{' '}
            <button type="button" className="min-h-11 break-all text-left text-accent-text underline-offset-4 hover:underline" onClick={() => void copy(ownerUrl)}>
              {ownerUrl}
            </button>
            .
          </p>
        </div>
        <InstallSteps platforms={['ios', 'android', 'desktop']} />
        <p className="text-xs text-fg-subtle">Уведомления на iPhone приходят только в установленное приложение (iOS 16.4+): так устроен Safari.</p>
      </Card>
    </Section>
  )
}
