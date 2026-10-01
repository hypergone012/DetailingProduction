/**
 * Generates DEMO artwork for a tenant from tenants/<slug>/art.json: stylized automotive
 * scenes rendered from SVG with sharp. Real photos could not be downloaded in the build
 * environment; every tenant using this output must keep `branding.demoArtwork: true`
 * (the live-readiness check refuses to go live until real photos replace them).
 *
 * Usage: pnpm tenant:art <slug> [<slug>...]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { z } from 'zod'

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const artSchema = z.strictObject({
  palette: z.strictObject({
    bg: hex,
    bg2: hex,
    paint: hex,
    paintHi: hex,
    glass: hex,
    light: hex,
    accent: hex,
    floor: hex,
    leather: hex,
    foam: hex,
  }),
  mark: z.enum(['facet', 'leaf', 'ring']),
  images: z.array(
    z.strictObject({
      file: z.string().regex(/^[a-z0-9/_-]+\.(jpg|png|svg)$/),
      scene: z.enum(['studio-side', 'panel-reflection', 'wheel', 'interior', 'beading', 'foam', 'ppf-edge', 'icon', 'logo', 'daylight-side']),
      w: z.number().int().optional(),
      h: z.number().int().optional(),
    }),
  ),
})
type Art = z.infer<typeof artSchema>
type Palette = Art['palette']

const CAR_BODY =
  'M 60 300 L 52 262 C 55 240, 90 228, 160 222 C 240 214, 300 205, 345 200 C 400 160, 440 140, 500 132 L 660 128 ' +
  'C 720 130, 780 160, 830 188 C 880 196, 920 200, 940 212 C 952 240, 955 270, 948 296 L 860 300 ' +
  'A 78 78 0 0 0 704 300 L 298 300 A 78 78 0 0 0 142 300 Z'
const CAR_GLASS = 'M 365 198 C 410 165, 445 148, 500 142 L 655 139 C 705 142, 750 162, 790 186 C 700 190, 520 196, 365 198 Z'

function wheel(cx: number, cy: number, p: Palette, spin = 0): string {
  const spokes = Array.from({ length: 10 }, (_, i) => {
    const a = ((i * 36 + spin) * Math.PI) / 180
    return `<line x1="${cx + Math.cos(a) * 12}" y1="${cy + Math.sin(a) * 12}" x2="${cx + Math.cos(a) * 42}" y2="${cy + Math.sin(a) * 42}" stroke="url(#rim)" stroke-width="7" stroke-linecap="round"/>`
  }).join('')
  return `<g><circle cx="${cx}" cy="${cy}" r="62" fill="#0b0b0c"/><circle cx="${cx}" cy="${cy}" r="46" fill="${p.bg}" stroke="url(#rim)" stroke-width="4"/>
    ${spokes}<circle cx="${cx}" cy="${cy}" r="11" fill="url(#rim)"/><circle cx="${cx}" cy="${cy}" r="52" fill="none" stroke="${p.accent}" stroke-opacity="0.35" stroke-width="2"/></g>`
}

function car(p: Palette, x: number, y: number, scale: number): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <path d="M 142 300 A 78 78 0 0 1 298 300 Z M 704 300 A 78 78 0 0 1 860 300 Z" fill="#0d0d0e"/>
    <path d="${CAR_BODY}" fill="url(#paint)"/>
    <path d="${CAR_BODY}" fill="url(#paintShade)"/>
    <path d="${CAR_GLASS}" fill="url(#glass)"/>
    <path d="M 120 238 C 300 222, 600 214, 905 222" stroke="${p.light}" stroke-opacity="0.75" stroke-width="3" fill="none" filter="url(#soft)"/>
    <path d="M 360 202 C 520 196, 700 192, 820 192" stroke="${p.light}" stroke-opacity="0.35" stroke-width="2" fill="none"/>
    <path d="M 70 262 L 120 258" stroke="${p.light}" stroke-width="5" stroke-linecap="round" filter="url(#glow)"/>
    <path d="M 930 230 L 946 252" stroke="#c4473f" stroke-width="5" stroke-linecap="round" filter="url(#glow)"/>
    ${wheel(220, 300, p)}${wheel(782, 300, p, 12)}
  </g>`
}

function shade(hexColor: string): string {
  const n = parseInt(hexColor.slice(1), 16)
  const c = (v: number) => Math.round(v * 0.35).toString(16).padStart(2, '0')
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`
}

function defs(p: Palette): string {
  return `<defs>
    <linearGradient id="paint" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.paintHi}"/><stop offset="0.35" stop-color="${p.paint}"/><stop offset="1" stop-color="${shade(p.paint)}"/>
    </linearGradient>
    <linearGradient id="paintShade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity="0.35"/><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.glass}"/><stop offset="1" stop-color="#050506"/></linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8e8ea"/><stop offset="1" stop-color="#4a4c52"/></linearGradient>
    <radialGradient id="room" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="${p.bg2}"/><stop offset="1" stop-color="${p.bg}"/></radialGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bg2}"/><stop offset="1" stop-color="${p.floor}"/></linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.3"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="reflect"><rect x="0" y="0" width="100%" height="100%" fill="url(#fade)"/></mask>
    <filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="haze" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="28"/></filter>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
  </defs>`
}

function lightStrips(p: Palette, w: number, y: number, n: number): string {
  return Array.from({ length: n }, (_, i) => {
    const x = (w / (n + 1)) * (i + 1) - w * 0.11
    return `<rect x="${x}" y="${y}" width="${w * 0.22}" height="10" rx="5" fill="${p.light}" filter="url(#glow)"/><rect x="${x}" y="${y + 2}" width="${w * 0.22}" height="5" rx="2.5" fill="${p.light}"/>`
  }).join('')
}

const scenes: Record<Art['images'][number]['scene'], (p: Palette, w: number, h: number) => string> = {
  'studio-side': (p, w, h) => {
    const scale = (w * 0.78) / 1000
    const x = (w - 1000 * scale) / 2
    const ground = h * 0.72
    const y = ground - 362 * scale
    return `${defs(p)}<rect width="${w}" height="${h}" fill="url(#room)"/>
      <rect y="${ground}" width="${w}" height="${h - ground}" fill="url(#floor)"/>
      ${lightStrips(p, w, h * 0.12, 3)}
      <ellipse cx="${w / 2}" cy="${ground + 4}" rx="${w * 0.36}" ry="${h * 0.035}" fill="#000" opacity="0.65" filter="url(#glow)"/>
      ${car(p, x, y, scale)}
      <g mask="url(#reflect)" transform="translate(0 ${2 * ground}) scale(1 -1)" opacity="0.5">${car(p, x, y, scale)}</g>
      <rect width="${w}" height="${h}" fill="url(#vignette)"/>`
  },
  'daylight-side': (p, w, h) => {
    const scale = (w * 0.74) / 1000
    const x = (w - 1000 * scale) / 2
    const ground = h * 0.74
    const y = ground - 362 * scale
    return `${defs(p)}<rect width="${w}" height="${h}" fill="${p.bg2}"/>
      <rect x="${w * 0.06}" y="${h * 0.08}" width="${w * 0.88}" height="${h * 0.46}" rx="18" fill="${p.light}" opacity="0.65"/>
      <path d="M ${w * 0.06} ${h * 0.31} H ${w * 0.94} M ${w * 0.36} ${h * 0.08} V ${h * 0.54} M ${w * 0.65} ${h * 0.08} V ${h * 0.54}" stroke="${p.bg2}" stroke-width="10"/>
      <rect y="${ground}" width="${w}" height="${h - ground}" fill="${p.floor}"/>
      <ellipse cx="${w / 2}" cy="${ground + 4}" rx="${w * 0.36}" ry="${h * 0.03}" fill="#000" opacity="0.35" filter="url(#glow)"/>
      ${car(p, x, y, scale)}`
  },
  'panel-reflection': (p, w, h) => `${defs(p)}<rect width="${w}" height="${h}" fill="${p.bg}"/>
      <path d="M 0 ${h * 0.25} C ${w * 0.3} ${h * 0.05}, ${w * 0.7} ${h * 0.1}, ${w} ${h * 0.3} L ${w} ${h} L 0 ${h} Z" fill="url(#paint)"/>
      <path d="M 0 ${h * 0.55} C ${w * 0.35} ${h * 0.38}, ${w * 0.65} ${h * 0.4}, ${w} ${h * 0.6}" stroke="${p.light}" stroke-width="14" fill="none" filter="url(#glow)"/>
      <path d="M 0 ${h * 0.55} C ${w * 0.35} ${h * 0.38}, ${w * 0.65} ${h * 0.4}, ${w} ${h * 0.6}" stroke="#fff" stroke-width="3" fill="none"/>
      <path d="M ${w * 0.1} ${h * 0.75} C ${w * 0.4} ${h * 0.62}, ${w * 0.6} ${h * 0.64}, ${w * 0.9} ${h * 0.8}" stroke="${p.light}" stroke-opacity="0.35" stroke-width="5" fill="none" filter="url(#soft)"/>
      <circle cx="${w * 0.78}" cy="${h * 0.42}" r="${h * 0.12}" fill="${p.accent}" opacity="0.18" filter="url(#haze)"/>
      <rect width="${w}" height="${h}" fill="url(#vignette)"/>`,
  wheel: (p, w, h) => {
    const s = Math.min(w, h) / 160
    return `${defs(p)}<rect width="${w}" height="${h}" fill="url(#room)"/>
      <g transform="translate(${w / 2 - 220 * s} ${h / 2 - 300 * s}) scale(${s})">${wheel(220, 300, p, 6)}</g>
      <path d="M 0 ${h * 0.2} C ${w * 0.25} ${h * 0.02}, ${w * 0.75} ${h * 0.02}, ${w} ${h * 0.2}" stroke="${p.paintHi}" stroke-width="${h * 0.06}" fill="none" opacity="0.6"/>
      <rect width="${w}" height="${h}" fill="url(#vignette)"/>`
  },
  interior: (p, w, h) => `${defs(p)}<rect width="${w}" height="${h}" fill="${p.bg}"/>
      <path d="M ${w * 0.18} ${h} L ${w * 0.22} ${h * 0.45} C ${w * 0.23} ${h * 0.2}, ${w * 0.45} ${h * 0.12}, ${w * 0.5} ${h * 0.32} L ${w * 0.52} ${h} Z" fill="${p.leather}"/>
      <path d="M ${w * 0.56} ${h} L ${w * 0.6} ${h * 0.5} C ${w * 0.61} ${h * 0.25}, ${w * 0.8} ${h * 0.18}, ${w * 0.84} ${h * 0.36} L ${w * 0.86} ${h} Z" fill="${p.leather}" opacity="0.85"/>
      ${Array.from({ length: 6 }, (_, i) => `<path d="M ${w * 0.24} ${h * (0.5 + i * 0.08)} H ${w * 0.5}" stroke="${p.accent}" stroke-width="2" stroke-dasharray="6 6" opacity="0.7"/>`).join('')}
      <path d="M ${w * 0.22} ${h * 0.45} C ${w * 0.25} ${h * 0.25}, ${w * 0.4} ${h * 0.2}, ${w * 0.48} ${h * 0.3}" stroke="${p.light}" stroke-opacity="0.4" stroke-width="6" fill="none" filter="url(#soft)"/>
      <rect width="${w}" height="${h}" fill="url(#vignette)"/>`,
  beading: (p, w, h) => {
    let seed = 7
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
    const drops = Array.from({ length: 70 }, () => {
      const r = 6 + rnd() * 26
      const cx = rnd() * w
      const cy = rnd() * h
      return `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.paintHi}" opacity="0.35"/><circle cx="${cx - r * 0.3}" cy="${cy - r * 0.35}" r="${r * 0.28}" fill="#fff" opacity="0.8"/><circle cx="${cx}" cy="${cy + r * 0.15}" r="${r}" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="2"/></g>`
    }).join('')
    return `${defs(p)}<rect width="${w}" height="${h}" fill="url(#paint)"/>${drops}<rect width="${w}" height="${h}" fill="url(#vignette)"/>`
  },
  foam: (p, w, h) => {
    let seed = 3
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
    const bubbles = Array.from({ length: 160 }, () => {
      const r = 8 + rnd() * 40
      return `<circle cx="${rnd() * w}" cy="${h * 0.15 + rnd() * h * 0.6}" r="${r}" fill="${p.foam}" opacity="${0.55 + rnd() * 0.4}"/>`
    }).join('')
    const scale = (w * 0.8) / 1000
    return `${defs(p)}<rect width="${w}" height="${h}" fill="${p.bg2}"/>${car(p, (w - 1000 * scale) / 2, h * 0.7 - 362 * scale, scale)}
      <g filter="url(#soft)">${bubbles}</g><rect y="${h * 0.7}" width="${w}" height="${h * 0.3}" fill="${p.floor}" opacity="0.85"/>`
  },
  'ppf-edge': (p, w, h) => `${defs(p)}<rect width="${w}" height="${h}" fill="${p.bg}"/>
      <path d="M 0 ${h * 0.35} C ${w * 0.4} ${h * 0.2}, ${w * 0.6} ${h * 0.25}, ${w} ${h * 0.45} L ${w} ${h} L 0 ${h} Z" fill="url(#paint)"/>
      <path d="M 0 ${h * 0.5} C ${w * 0.4} ${h * 0.35}, ${w * 0.6} ${h * 0.4}, ${w} ${h * 0.6} L ${w} ${h} L 0 ${h} Z" fill="#fff" opacity="0.08"/>
      <path d="M 0 ${h * 0.5} C ${w * 0.4} ${h * 0.35}, ${w * 0.6} ${h * 0.4}, ${w} ${h * 0.6}" stroke="${p.light}" stroke-width="3" fill="none" filter="url(#soft)"/>
      <path d="M ${w * 0.62} ${h * 0.47} l ${w * 0.08} ${h * 0.12}" stroke="${p.accent}" stroke-width="6" stroke-linecap="round"/>
      <rect width="${w}" height="${h}" fill="url(#vignette)"/>`,
  icon: (p, w, h) => `${defs(p)}<rect width="${w}" height="${h}" fill="${p.bg}"/>${mark(p, w, h, 0.56)}`,
  logo: (p, w, h) => mark(p, w, h, 0.92),
}

function mark(p: Palette, w: number, h: number, size: number): string {
  const s = Math.min(w, h) * size
  const x = (w - s) / 2
  const y = (h - s) / 2
  const g = (body: string) => `<g transform="translate(${x} ${y}) scale(${s / 100})">${body}</g>`
  switch (art.mark) {
    case 'facet':
      return g(`<path d="M50 4 L92 28 L92 72 L50 96 L8 72 L8 28 Z" fill="none" stroke="${p.accent}" stroke-width="6" stroke-linejoin="round"/>
        <path d="M50 4 L50 50 L92 72 M50 50 L8 72" stroke="${p.accent}" stroke-width="4" stroke-opacity="0.6" fill="none"/>
        <path d="M50 22 L74 36 L74 50 L50 50 Z" fill="${p.accent}"/>`)
    case 'leaf':
      return g(`<path d="M50 6 C 84 26, 90 62, 50 94 C 10 62, 16 26, 50 6 Z" fill="${p.accent}"/>
        <path d="M50 22 L50 84 M50 46 L66 34 M50 62 L34 50" stroke="${p.bg}" stroke-width="5" stroke-linecap="round" fill="none"/>`)
    default:
      return g(`<circle cx="50" cy="50" r="42" fill="none" stroke="${p.accent}" stroke-width="10"/><circle cx="50" cy="50" r="14" fill="${p.accent}"/>`)
  }
}

let art: Art

async function render(slug: string) {
  const dir = join(import.meta.dirname, '../../tenants', slug)
  art = artSchema.parse(JSON.parse(readFileSync(join(dir, 'art.json'), 'utf8')))
  for (const img of art.images) {
    const w = img.w ?? (img.scene === 'icon' ? 1024 : 1600)
    const h = img.h ?? (img.scene === 'icon' ? 1024 : 1000)
    const body = scenes[img.scene](art.palette, w, h)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
    const out = join(dir, 'assets', img.file)
    mkdirSync(dirname(out), { recursive: true })
    if (img.file.endsWith('.svg')) writeFileSync(out, svg)
    else if (img.file.endsWith('.png')) await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out)
    else await sharp(Buffer.from(svg)).jpeg({ quality: 82, mozjpeg: true }).toFile(out)
    console.log(`  ${slug}/assets/${img.file}`)
  }
}

const slugs = process.argv.slice(2)
if (slugs.length === 0) {
  console.error('usage: pnpm tenant:art <slug> [...]')
  process.exit(2)
}
for (const slug of slugs) await render(slug)
