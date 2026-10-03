/**
 * How the self-hosted server answers a request for the web app — pure rules, no I/O, shared
 * by the gateway (Deno) and its tests (Vitest). Mirrors what the static host did:
 *
 * - a file that exists is served as is (a directory serves its index.html);
 * - every studio has its own shell: /s/<slug>/owner/* → /s/<slug>/owner/index.html,
 *   /s/<slug>/* → /s/<slug>/index.html (written by `pnpm tenant:shells`);
 * - any other page path → /index.html (the app routes it);
 * - a missing file with an extension (an old /assets/ chunk after a deploy, a typo) is a real
 *   404, never the HTML page: a script request that gets HTML breaks the app silently, a 404
 *   lets it recover (see src/pwa/chunk-recovery.ts).
 *
 * Response headers come from the build's `_headers` file (Netlify / Cloudflare Pages format).
 */

export interface HeaderRule {
  pattern: string
  headers: [string, string][]
}

/** Parses a `_headers` file: a path pattern line, then indented `Name: value` lines. */
export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = []
  let current: HeaderRule | null = null
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] }
      rules.push(current)
      continue
    }
    const i = raw.indexOf(':')
    if (current && i > 0) current.headers.push([raw.slice(0, i).trim().toLowerCase(), raw.slice(i + 1).trim()])
  }
  return rules
}

/** `*` matches anything (including `/`); everything else literally. */
export function matchPattern(pattern: string, path: string): boolean {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
  return re.test(path)
}

/** All matching rules apply, in file order (a later rule wins for the same header). */
export function headersFor(rules: HeaderRule[], path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rules) if (matchPattern(r.pattern, path)) for (const [k, v] of r.headers) out[k] = v
  return out
}

export type Resolution = { file: string } | { notFound: true }

/**
 * The file that answers `pathname`. `isFile` tells whether a path (relative to the web root,
 * starting with "/") is an existing file.
 */
export function resolveWebPath(pathname: string, isFile: (p: string) => boolean): Resolution {
  let path: string
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return { notFound: true }
  }
  // No way out of the web root, no hidden files.
  if (!path.startsWith('/') || path.includes('\0') || path.split('/').some((seg) => seg === '..' || seg.startsWith('.'))) return { notFound: true }
  // The host's own rule files are configuration, not content.
  if (path === '/_headers' || path === '/_redirects') return { notFound: true }
  if (isFile(path)) return { file: path }
  const dirIndex = path.replace(/\/?$/, '/') + 'index.html'
  if (isFile(dirIndex)) return { file: dirIndex }
  const studio = /^\/s\/([a-z0-9-]+)(\/owner(?:\/.*)?)?(?:\/.*)?$/.exec(path)
  if (studio) {
    if (studio[2] && isFile(`/s/${studio[1]}/owner/index.html`)) return { file: `/s/${studio[1]}/owner/index.html` }
    if (isFile(`/s/${studio[1]}/index.html`)) return { file: `/s/${studio[1]}/index.html` }
  }
  const last = path.split('/').pop() ?? ''
  if (path.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(last)) return { notFound: true }
  return { file: '/index.html' }
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
}

export function contentType(file: string): string {
  return TYPES[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}
