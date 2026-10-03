import type { MediaView } from '@dp/core/api/contracts'
import { cn } from '@/lib/utils'

/** Responsive image from processed media: srcset of the uploaded variants, intrinsic size to avoid layout shift. */
export function Img({ media, sizes = '100vw', alt, className, priority = false }: { media: MediaView | undefined; sizes?: string; alt?: string; className?: string; priority?: boolean }) {
  if (!media?.url) return <div className={cn('bg-sunken', className)} aria-hidden />
  const srcSet = media.variants.filter((v) => v.url && !v.purpose).map((v) => `${v.url} ${v.w}w`).join(', ')
  return (
    <img
      // Fades in once decoded (see img[data-fade] in globals.css); cached images are marked at once.
      ref={(el) => {
        if (el?.complete) el.dataset.loaded = ''
      }}
      onLoad={(e) => (e.currentTarget.dataset.loaded = '')}
      onError={(e) => (e.currentTarget.dataset.loaded = '')}
      data-fade=""
      src={media.url}
      srcSet={srcSet || undefined}
      sizes={srcSet ? sizes : undefined}
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      alt={alt ?? media.alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      className={cn('object-cover', className)}
    />
  )
}
