import { CalendarClock, ChevronRight, LogOut } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { AppearancePicker } from '@/components/AppearancePicker'
import { ScreenHeader } from '@/components/ScreenHeader'
import { Card, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api/http'
import { useSession } from '../auth/session'
import { useOwner, useSettings } from '../data'
import { ROLE_LABEL } from '../shared/labels'
import { BrandingSection } from './BrandingSection'
import { GallerySection } from './GallerySection'
import { NotificationsSection } from './NotificationsSection'
import { ProfileSection } from './ProfileSection'
import { RulesSection } from './RulesSection'
import { ShareSection } from './ShareSection'
import { StatusSection } from './StatusSection'

export function SettingsScreen() {
  const { slug, email, role, canManage, isOwner } = useOwner()
  const { signOut } = useSession()
  const settings = useSettings()
  const { hash } = useLocation()
  useEffect(() => {
    if (hash && settings.data) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [hash, settings.data])

  return (
    <>
      <ScreenHeader title="Студия" large wide />
      <div className="mx-auto grid max-w-3xl gap-8 px-4 pb-10">
        {settings.isPending ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : settings.isError ? (
          <p className="text-sm text-danger">{errorMessage(settings.error)}</p>
        ) : (
          <>
            <StatusSection tenant={settings.data.tenant} />
            <ShareSection />
            <Link to={`/s/${slug}/owner/schedule`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus">
              <CalendarClock className="size-5 text-fg-subtle" aria-hidden />
              <span className="grid flex-1">
                <span className="font-medium">Расписание и ресурсы</span>
                <span className="text-sm text-fg-muted">Рабочие часы, праздники, боксы и посты</span>
              </span>
              <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
            </Link>
            {isOwner && <ProfileSection tenant={settings.data.tenant} settings={settings.data.settings} />}
            {isOwner && <BrandingSection settings={settings.data.settings} />}
            {canManage && <GallerySection />}
            {isOwner && <RulesSection settings={settings.data.settings} />}
            {!isOwner && <p className="rounded-2xl bg-sunken p-4 text-sm text-fg-muted">Профиль студии, брендинг и правила записи меняет владелец.</p>}
            <NotificationsSection settings={settings.data.settings} />
          </>
        )}
        <Section title="Оформление на этом устройстве">
          <p className="-mt-1 px-1 text-sm text-fg-muted">Меняет цвета только для вас. Брендинг студии для клиентов задаётся выше.</p>
          <Card className="p-4">
            <AppearancePicker />
          </Card>
        </Section>
        <Section title="Аккаунт">
          <Card className="flex items-center gap-3 p-4">
            <span className="grid min-w-0 flex-1">
              <span className="truncate font-medium">{email}</span>
              <span className="text-sm text-fg-muted">{ROLE_LABEL[role]}</span>
            </span>
            <Button variant="secondary" onClick={() => void signOut()}>
              <LogOut /> Выйти
            </Button>
          </Card>
        </Section>
      </div>
    </>
  )
}
