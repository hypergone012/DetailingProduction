#!/usr/bin/env node
/**
 * Network path diagnostics for a published studio page — run in CI (Actions → "Diagnose
 * network") or locally: node scripts/ops/net-diagnose.mjs https://<host>/s/<slug>/
 *
 * 1. From the machine running it: DNS (A/AAAA/CNAME), TLS (version, ALPN, issuer), HTTP/3
 *    advertisement, redirects, CDN headers and full downloads (TTFB, size, time) of the page,
 *    its JS/CSS/fonts, the manifest, the API (studio data) and a photo.
 * 2. From probes inside Russia (Globalping, check-host.net): the same URLs, so a block or the
 *    "first 16 KB then stall" throttling of foreign CDNs shows up as failures or timeouts on
 *    the large files while the small page still loads.
 *
 * --require-ru: exit 1 unless every part of the site loads from at least half of the Russian
 * Globalping probes (the server deploy's final check).
 *
 * Prints only public facts (hostnames, headers, timings): no keys, no tokens.
 */
import { promises as dns } from 'node:dns'
import tls from 'node:tls'

const pageUrl = new URL(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'https://detailing-studio-6wl.pages.dev/s/graphite/')
const out = []
const log = (s = '') => {
  console.log(s)
  out.push(s)
}
const ms = (t) => `${Math.round(t)} ms`
const kb = (n) => (n == null ? '?' : `${(n / 1024).toFixed(1)} KB`)

async function timed(url, init = {}, limitMs = 30000) {
  const t0 = performance.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), limitMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: init.redirect ?? 'follow' })
    const ttfb = performance.now() - t0
    const body = init.method === 'HEAD' || init.redirect === 'manual' ? new Uint8Array() : new Uint8Array(await res.arrayBuffer())
    return { ok: true, status: res.status, headers: res.headers, ttfb, total: performance.now() - t0, bytes: body.length, body, url: res.url }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? `timeout ${limitMs} ms` : String(e.cause?.code ?? e.message), total: performance.now() - t0 }
  } finally {
    clearTimeout(timer)
  }
}

async function dnsInfo(host) {
  const r = {}
  for (const [k, fn] of [['A', dns.resolve4], ['AAAA', dns.resolve6], ['CNAME', dns.resolveCname]]) {
    const t0 = performance.now()
    try {
      r[k] = { values: await fn.call(dns, host), ms: performance.now() - t0 }
    } catch (e) {
      r[k] = { values: [], error: e.code, ms: performance.now() - t0 }
    }
  }
  return r
}

function tlsInfo(host) {
  return new Promise((resolve) => {
    const t0 = performance.now()
    const s = tls.connect({ host, port: 443, servername: host, ALPNProtocols: ['h2', 'http/1.1'], timeout: 15000 }, () => {
      const c = s.getPeerCertificate()
      resolve({ version: s.getProtocol(), alpn: s.alpnProtocol, issuer: c.issuer?.O ?? c.issuer?.CN, validTo: c.valid_to, ms: performance.now() - t0 })
      s.end()
    })
    s.on('error', (e) => resolve({ error: e.code ?? e.message }))
    s.on('timeout', () => {
      resolve({ error: 'timeout' })
      s.destroy()
    })
  })
}

const cdnOf = (h) => {
  if (!h) return '?'
  if (h.get('cf-ray')) return `Cloudflare (cf-ray ${h.get('cf-ray')})`
  return h.get('server') ?? h.get('via') ?? '?'
}

// ---------------------------------------------------------------------------------------
log(`# Network diagnostics: ${pageUrl.href}`)
log(`Run at ${new Date().toISOString()} from ${process.env.GITHUB_ACTIONS ? 'a GitHub Actions runner' : 'this machine'}`)
log()

const page = await timed(pageUrl.href)
if (!page.ok) {
  log(`Page FAILED: ${page.error}`)
  process.exit(1)
}
const html = new TextDecoder().decode(page.body)
const abs = (p) => new URL(p, pageUrl).href
const assets = {
  js: [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => abs(m[1])),
  preload: [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map((m) => abs(m[1])),
  css: [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => abs(m[1])),
  fonts: [...html.matchAll(/<link[^>]+as="font"[^>]+href="([^"]+)"/g)].map((m) => abs(m[1])),
  manifest: [...html.matchAll(/<link[^>]+rel="manifest"[^>]+href="([^"]+)"/g)].map((m) => abs(m[1])),
}
let apiOrigin = html.match(/preconnect" href="(https:\/\/[^"]+)"/)?.[1]
if (!apiOrigin && assets.js[0]) {
  const main = await timed(assets.js[0])
  apiOrigin = new TextDecoder().decode(main.body ?? new Uint8Array()).match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0]
}
const slug = pageUrl.pathname.match(/^\/s\/([a-z0-9-]+)/)?.[1]
const apiUrl = apiOrigin && slug ? `${apiOrigin.replace(/\/$/, '')}/functions/v1/public-api/t/${slug}` : null

log('## Hosts')
for (const host of [pageUrl.host, apiOrigin && new URL(apiOrigin).host].filter(Boolean)) {
  const d = await dnsInfo(host)
  const t = await tlsInfo(host)
  log(`- ${host}`)
  log(`  - DNS A: ${d.A.values.join(', ') || d.A.error} (${ms(d.A.ms)}); AAAA: ${d.AAAA.values.join(', ') || d.AAAA.error}; CNAME: ${d.CNAME.values.join(', ') || d.CNAME.error}`)
  log(`  - TLS: ${t.error ?? `${t.version}, ALPN ${t.alpn}, issuer ${t.issuer}, valid to ${t.validTo}, handshake ${ms(t.ms)}`}`)
}
log()

log('## Redirects')
for (const start of [`http://${pageUrl.host}${pageUrl.pathname}`, `https://${pageUrl.host}${pageUrl.pathname.replace(/\/$/, '')}`]) {
  const r = await timed(start, { redirect: 'manual' })
  log(`- ${start} → ${r.ok ? `${r.status} ${r.headers.get('location') ?? ''}` : r.error}`)
}
log()

const targets = [
  ['page (HTML)', pageUrl.href],
  ...assets.js.map((u) => ['entry JS', u]),
  ...assets.preload.slice(0, 3).map((u) => ['preloaded JS', u]),
  ...assets.css.map((u) => ['CSS', u]),
  ...assets.fonts.map((u) => ['font', u]),
  ...assets.manifest.map((u) => ['manifest', u]),
]
if (apiUrl) {
  targets.push(['API: studio data', apiUrl])
  const boot = await timed(apiUrl)
  try {
    const data = JSON.parse(new TextDecoder().decode(boot.body))
    const hero = data.media?.find((m) => m.kind === 'hero')
    const photo = hero?.variants?.find((v) => v.w === 1280)?.url ?? hero?.url
    if (photo) targets.push(['photo (cover)', photo])
  } catch {
    /* reported below */
  }
}

log('## Downloads from this machine')
log('| what | status | CDN | HTTP/3 offered | encoding | cache-control | size | TTFB | total |')
log('|---|---|---|---|---|---|---|---|---|')
for (const [what, url] of targets) {
  const r = await timed(url, { headers: { 'accept-encoding': 'br, gzip' } })
  if (!r.ok) {
    log(`| ${what} | FAILED ${r.error} | | | | | | | ${ms(r.total)} |`)
    continue
  }
  const h = r.headers
  log(`| ${what} | ${r.status} | ${cdnOf(h)} | ${/h3/.test(h.get('alt-svc') ?? '') ? 'yes' : 'no'} | ${h.get('content-encoding') ?? '-'} | ${h.get('cache-control') ?? '-'} | ${kb(r.bytes)} | ${ms(r.ttfb)} | ${ms(r.total)} |`)
}
log()

// ---------------------------------------------------------------------------------------
// Probes inside Russia.
const ruTargets = targets.filter(([what]) => ['page (HTML)', 'entry JS', 'CSS', 'API: studio data', 'photo (cover)'].includes(what))
/** what -> results of the Russian probes (--require-ru turns them into a verdict). */
const ruResults = new Map()

async function globalping() {
  log('## From Russia: Globalping probes (HTTP GET, full timings)')
  log('| what | probe (city, network) | status | first byte | download | total | error |')
  log('|---|---|---|---|---|---|---|')
  for (const [what, url] of ruTargets) {
    const u = new URL(url)
    const create = await timed('https://api.globalping.io/v1/measurements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'http',
        target: u.host,
        locations: [{ country: 'RU', limit: 4 }],
        measurementOptions: { protocol: 'HTTPS', request: { method: 'GET', path: u.pathname, ...(u.search ? { query: u.search.slice(1) } : {}) } },
      }),
    })
    const id = create.ok && create.status < 300 ? JSON.parse(new TextDecoder().decode(create.body)).id : null
    if (!id) {
      log(`| ${what} | — | could not start (${create.ok ? create.status + ' ' + new TextDecoder().decode(create.body).replace(/\s+/g, ' ').slice(0, 400) : create.error}) | | | | |`)
      continue
    }
    let result = null
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      const r = await timed(`https://api.globalping.io/v1/measurements/${id}`)
      const j = r.ok ? JSON.parse(new TextDecoder().decode(r.body)) : null
      if (j?.status === 'finished') {
        result = j
        break
      }
    }
    if (!result) {
      log(`| ${what} | — | no result in 60 s | | | | |`)
      continue
    }
    for (const p of result.results) {
      const r = p.result
      const t = r.timings ?? {}
      const code = Number(r.statusCode)
      ruResults.set(what, [...(ruResults.get(what) ?? []), r.status === 'finished' && code >= 200 && code < 400])
      log(`| ${what} | ${p.probe.city}, ${p.probe.network} (AS${p.probe.asn}) | ${r.statusCode ?? r.status} | ${t.firstByte ?? '-'} ms | ${t.download ?? '-'} ms | ${t.total ?? '-'} ms | ${r.status === 'finished' ? '' : (r.rawOutput ?? '').slice(0, 80).replace(/\|/g, '/')} |`)
    }
  }
  log()
}

async function checkHost() {
  log('## From Russia: check-host.net nodes (HTTP check)')
  const nodes = await timed('https://check-host.net/nodes/hosts', { headers: { accept: 'application/json' } })
  let ru
  try {
    ru = Object.entries(JSON.parse(new TextDecoder().decode(nodes.body)).nodes)
      .filter(([, n]) => n.location?.[0] === 'ru')
      .map(([name, n]) => [name, `${n.location[2]} (${n.asn ?? ''})`])
  } catch {
    log(`node list unavailable (${nodes.ok ? nodes.status : nodes.error})`)
    return
  }
  log(`RU nodes: ${ru.map(([n, l]) => `${n} ${l}`).join('; ') || 'none'}`)
  log('| what | node | result | time |')
  log('|---|---|---|---|')
  for (const [what, url] of ruTargets) {
    const q = new URLSearchParams({ host: url })
    for (const [n] of ru) q.append('node', n)
    const start = await timed(`https://check-host.net/check-http?${q}`, { headers: { accept: 'application/json' } })
    let id = null
    try {
      id = JSON.parse(new TextDecoder().decode(start.body)).request_id
    } catch {
      /* not JSON */
    }
    if (!id) {
      log(`| ${what} | — | could not start (${start.ok ? `${start.status} ${new TextDecoder().decode(start.body).replace(/\s+/g, ' ').slice(0, 200)}` : start.error}) | |`)
      continue
    }
    let res = null
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const r = await timed(`https://check-host.net/check-result/${id}`, { headers: { accept: 'application/json' } })
      try {
        res = r.ok ? JSON.parse(new TextDecoder().decode(r.body)) : null
      } catch {
        res = null
      }
      if (res && Object.values(res).every((v) => v !== null)) break
    }
    for (const [n] of ru) {
      const v = res?.[n]?.[0]
      log(`| ${what} | ${n} | ${v ? `${v[0] ? 'OK' : 'FAIL'} ${v[3] ?? ''} ${v[2] ?? ''}`.trim() : 'no answer'} | ${v?.[1] != null ? `${(v[1] * 1000).toFixed(0)} ms` : ''} |`)
    }
  }
  log()
}

await globalping()
await checkHost()

// --require-ru: the deploy's check. Every part of the site must load from at least half of the
// Russian probes; no probe data at all is reported as "not confirmed", never as a pass.
let verdict = 0
if (process.argv.includes('--require-ru')) {
  log('## Verdict: reachable from Russia?')
  const counted = ruTargets.map(([what]) => [what, ruResults.get(what) ?? []])
  if (counted.every(([, r]) => r.length === 0)) {
    log('NOT CONFIRMED: the Russian probes gave no results (service limit or outage). Run "Diagnose network" again later.')
  } else {
    for (const [what, r] of counted) {
      const okN = r.filter(Boolean).length
      const pass = r.length > 0 && okN * 2 >= r.length
      log(`- ${what}: ${okN}/${r.length} probes OK — ${pass ? 'pass' : 'FAIL'}`)
      if (!pass) verdict = 1
    }
    log(verdict ? 'FAIL: some parts of the site do not load from Russia.' : 'PASS: every part of the site loaded from the Russian probes.')
  }
  log()
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n')
}
process.exit(verdict)
