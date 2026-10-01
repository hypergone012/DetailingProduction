import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaKey, resolveTheme, type Business, type PublishedImage } from '@dp/core'
import sharp from 'sharp'
import { publicUrl, upload, type Env } from './supabase.ts'

const PIPELINE_VERSION = 'img-v1'
const BUCKET = 'public-media'

interface Job {
  kind: PublishedImage['kind']
  src: string
  alt: string
  caption: string
  serviceKey: string | null
  sort: number
  widths: number[]
}

export interface ProcessedImage extends PublishedImage {
  files: { path: string; data: Buffer; type: string }[]
}

const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex').slice(0, 16)

async function rasterVariants(tenantId: string, job: Job, source: Buffer): Promise<ProcessedImage> {
  const meta = await sharp(source).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const widths = [...new Set(job.widths.map((w) => Math.min(w, width)))].sort((a, b) => a - b)
  const hash = sha(Buffer.concat([source, Buffer.from(PIPELINE_VERSION + job.widths.join(','))]))
  const files: ProcessedImage['files'] = []
  const variants: PublishedImage['variants'] = []
  for (const w of widths) {
    const path = `${tenantId}/config/${hash}-${w}.webp`
    const data = await sharp(source).resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
    files.push({ path, data, type: 'image/webp' })
    variants.push({ w, path })
  }
  const largest = variants.at(-1)!
  return {
    key: mediaKey(job.kind, job.src),
    kind: job.kind,
    path: largest.path,
    variants,
    width: largest.w,
    height: Math.round((height / width) * largest.w),
    alt: job.alt,
    caption: job.caption,
    service_key: job.serviceKey,
    sort_order: job.sort,
    files,
  }
}

async function logoVariants(tenantId: string, src: string, source: Buffer): Promise<ProcessedImage> {
  const hash = sha(Buffer.concat([source, Buffer.from(PIPELINE_VERSION + 'logo')]))
  const files: ProcessedImage['files'] = []
  const variants: PublishedImage['variants'] = []
  for (const w of [128, 256, 512]) {
    const path = `${tenantId}/config/${hash}-logo-${w}.png`
    const data = await sharp(source, { density: 300 }).resize({ width: w, height: w, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    files.push({ path, data, type: 'image/png' })
    variants.push({ w, path })
  }
  return { key: mediaKey('logo', src), kind: 'logo', path: variants[1]!.path, variants, width: 256, height: 256, alt: '', caption: '', service_key: null, sort_order: 0, files }
}

/** App icons: any (192/512), maskable (512, 80% safe zone on the theme background), apple (180), favicon (48). */
async function iconVariants(tenantId: string, src: string, source: Buffer, background: string): Promise<ProcessedImage> {
  const hash = sha(Buffer.concat([source, Buffer.from(PIPELINE_VERSION + 'icon' + background)]))
  const bg = background
  const files: ProcessedImage['files'] = []
  const variants: (PublishedImage['variants'][number] & { purpose: string })[] = []
  const add = async (name: string, size: number, purpose: string, pad: number) => {
    const inner = Math.round(size * (1 - pad))
    const icon = await sharp(source, { density: 300 }).resize(inner, inner, { fit: 'contain', background: bg }).png().toBuffer()
    const data = await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
      .composite([{ input: icon, gravity: 'center' }])
      .png()
      .toBuffer()
    const path = `${tenantId}/config/${hash}-${name}.png`
    files.push({ path, data, type: 'image/png' })
    variants.push({ w: size, path, purpose })
  }
  await add('icon-192', 192, 'any', 0)
  await add('icon-512', 512, 'any', 0)
  await add('maskable-512', 512, 'maskable', 0.2)
  await add('apple-180', 180, 'apple', 0.08)
  await add('favicon-48', 48, 'favicon', 0)
  return { key: 'icon', kind: 'icon', path: variants[1]!.path, variants, width: 512, height: 512, alt: '', caption: '', service_key: null, sort_order: 0, files }
}

/** Processes every config image of a tenant into deterministic, content-addressed files. */
export async function processImages(b: Business, dir: string): Promise<ProcessedImage[]> {
  const read = (src: string) => readFileSync(join(dir, src))
  const jobs: Job[] = [
    { kind: 'hero', src: b.branding.hero, alt: b.branding.heroAlt, caption: '', serviceKey: null, sort: 0, widths: [640, 1024, 1600] },
    ...b.branding.gallery.map((g, i): Job => ({ kind: 'gallery', src: g.src, alt: g.alt, caption: g.caption, serviceKey: null, sort: i, widths: [480, 960, 1440] })),
    ...b.services.flatMap((s) =>
      s.images.map((img, i): Job => ({ kind: 'service', src: img.src, alt: img.alt, caption: img.caption, serviceKey: s.key, sort: i, widths: [480, 960] })),
    ),
  ]
  const out: ProcessedImage[] = []
  for (const job of jobs) {
    const img = await rasterVariants(b.id, job, read(job.src))
    // the same file used twice (e.g. one photo for two services) gets one key per use
    if (out.some((o) => o.key === img.key)) img.key = `${img.key}-${job.serviceKey ?? job.sort}`.slice(0, 64)
    out.push(img)
  }
  out.push(await logoVariants(b.id, b.branding.logo, read(b.branding.logo)))
  const theme = resolveTheme(b.branding.themePreset, b.branding.accent)
  out.push(await iconVariants(b.id, b.branding.icon ?? b.branding.logo, read(b.branding.icon ?? b.branding.logo), theme.bg))
  return out
}

export async function uploadImages(env: Env, images: ProcessedImage[]): Promise<{ uploaded: number; existing: number }> {
  let uploaded = 0
  let existing = 0
  const files = images.flatMap((i) => i.files)
  const queue = [...files]
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const r = await upload(env, BUCKET, f.path, f.data, f.type)
        if (r === 'uploaded') uploaded++
        else existing++
      }
    }),
  )
  return { uploaded, existing }
}

export const mediaUrl = (env: Env, path: string) => publicUrl(env, BUCKET, path)

export function stripFiles(images: ProcessedImage[]): PublishedImage[] {
  return images.map(({ files: _files, ...rest }) => rest)
}
