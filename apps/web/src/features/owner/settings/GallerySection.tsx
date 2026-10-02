import { Camera, Eye, EyeOff, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Card, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api/http'
import { cn } from '@/lib/utils'
import { tenantQueryKey } from '@/tenant/TenantProvider'
import { rpc } from '../api/client'
import type { MediaRow } from '../api/types'
import { publicMediaUrl, useMedia, useOwner, useOwnerMutation } from '../data'
import { deleteMedia, uploadImage } from '../shared/upload'

/** "Работы студии" on the client home page. */
export function GallerySection() {
  const { tenantId, slug } = useOwner()
  const media = useMedia()
  const ref = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const gallery = (media.data ?? []).filter((m) => m.kind === 'gallery')
  const upload = useOwnerMutation(
    async (files: File[]) => {
      for (const file of files) {
        const up = await uploadImage(tenantId, 'public-media', 'gallery', file)
        await rpc('owner_register_media', {
          p_tenant: tenantId,
          p_media: { kind: 'gallery', bucket: 'public-media', path: up.path, width: up.width, height: up.height, sort_order: -Math.floor(Date.now() / 1000) },
        })
      }
    },
    [tenantQueryKey(slug)],
  )
  return (
    <Section title="Фото работ">
      <Card className="grid gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-fg-muted">Показываются на главной странице записи. Новые — первыми.</p>
          <Button variant="secondary" size="sm" loading={upload.isPending} onClick={() => (setError(null), ref.current?.click())}>
            <Camera /> Добавить
          </Button>
          <input
            ref={ref}
            type="file"
            aria-label="Добавить фото работ"
            accept="image/*"
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])].slice(0, 10)
              if (files.length) upload.mutate(files, { onError: (err) => setError(errorMessage(err)) })
              e.target.value = ''
            }}
          />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {media.isPending ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : gallery.length === 0 ? (
          <p className="rounded-xl bg-sunken p-3 text-sm text-fg-muted">Фото пока нет.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {gallery.map((m) => (
              <GalleryItem key={m.id} m={m} />
            ))}
          </div>
        )}
      </Card>
    </Section>
  )
}

function GalleryItem({ m }: { m: MediaRow }) {
  const { slug } = useOwner()
  const [caption, setCaption] = useState(m.caption)
  const update = useOwnerMutation((patch: Record<string, unknown>) => rpc('owner_update_media', { p_media: m.id, p_patch: patch }), [tenantQueryKey(slug)])
  const remove = useOwnerMutation(() => deleteMedia(m.id), [tenantQueryKey(slug)])
  const thumb = m.variants.find((v) => v.w <= 640 && !v.purpose)?.path ?? m.path
  return (
    <figure className="grid gap-1.5">
      <div className="relative">
        <img src={publicMediaUrl(thumb)} alt={m.alt || m.caption} className={cn('aspect-[4/3] w-full rounded-lg object-cover', !m.client_visible && 'opacity-40')} loading="lazy" />
        <div className="absolute top-1 right-1 flex gap-1">
          <Button size="icon-sm" variant="secondary" aria-label={m.client_visible ? 'Скрыть от клиентов' : 'Показывать клиентам'} loading={update.isPending} onClick={() => update.mutate({ client_visible: !m.client_visible })}>
            {m.client_visible ? <Eye /> : <EyeOff />}
          </Button>
          <Button size="icon-sm" variant="secondary" aria-label="Удалить фото" loading={remove.isPending} onClick={() => remove.mutate(undefined)}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <Input
        aria-label="Подпись"
        value={caption}
        maxLength={200}
        placeholder="Подпись"
        className="h-9 text-sm"
        onChange={(e) => setCaption(e.target.value)}
        onBlur={() => caption !== m.caption && update.mutate({ caption })}
      />
    </figure>
  )
}
