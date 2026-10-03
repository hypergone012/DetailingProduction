import { describe, expect, it } from 'vitest'
import { contentType, headersFor, parseHeadersFile, resolveWebPath } from './web-rules'

const files = new Set(['/index.html', '/sw.js', '/assets/index-abc.js', '/s/graphite/index.html', '/s/graphite/owner/index.html', '/s/graphite/manifest.webmanifest', '/icons/a.png'])
const isFile = (p: string) => files.has(p)

describe('resolveWebPath', () => {
  it('serves existing files and directory indexes', () => {
    expect(resolveWebPath('/assets/index-abc.js', isFile)).toEqual({ file: '/assets/index-abc.js' })
    expect(resolveWebPath('/', isFile)).toEqual({ file: '/index.html' })
    expect(resolveWebPath('/s/graphite/', isFile)).toEqual({ file: '/s/graphite/index.html' })
    expect(resolveWebPath('/s/graphite/manifest.webmanifest', isFile)).toEqual({ file: '/s/graphite/manifest.webmanifest' })
  })

  it('gives every studio page its own shell, the cabinet its own', () => {
    expect(resolveWebPath('/s/graphite', isFile)).toEqual({ file: '/s/graphite/index.html' })
    expect(resolveWebPath('/s/graphite/services/123', isFile)).toEqual({ file: '/s/graphite/index.html' })
    expect(resolveWebPath('/s/graphite/owner', isFile)).toEqual({ file: '/s/graphite/owner/index.html' })
    expect(resolveWebPath('/s/graphite/owner/calendar', isFile)).toEqual({ file: '/s/graphite/owner/index.html' })
    expect(resolveWebPath('/s/graphite/ownerx', isFile)).toEqual({ file: '/s/graphite/index.html' })
    // a studio published after the last deploy: the generic app shell
    expect(resolveWebPath('/s/new-studio/history', isFile)).toEqual({ file: '/index.html' })
  })

  it('answers a missing script or file with 404, never with the page', () => {
    expect(resolveWebPath('/assets/index-old.js', isFile)).toEqual({ notFound: true })
    expect(resolveWebPath('/assets/anything', isFile)).toEqual({ notFound: true })
    expect(resolveWebPath('/favicon.ico', isFile)).toEqual({ notFound: true })
    expect(resolveWebPath('/some/page', isFile)).toEqual({ file: '/index.html' })
  })

  it('never leaves the web root or serves hidden files', () => {
    expect(resolveWebPath('/../etc/passwd', isFile)).toEqual({ notFound: true })
    expect(resolveWebPath('/assets/%2e%2e/%2e%2e/secret', isFile)).toEqual({ notFound: true })
    expect(resolveWebPath('/.env', isFile)).toEqual({ notFound: true })
    expect(resolveWebPath('/_headers', (p) => p === '/_headers')).toEqual({ notFound: true })
    expect(resolveWebPath('/_redirects', (p) => p === '/_redirects')).toEqual({ notFound: true })
    expect(resolveWebPath('/%E0%A4%A', isFile)).toEqual({ notFound: true })
    expect(resolveWebPath('/a\0b', isFile)).toEqual({ notFound: true })
  })
})

describe('_headers', () => {
  const rules = parseHeadersFile(`# comment
/sw.js
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`)
  it('applies every matching rule', () => {
    expect(headersFor(rules, '/assets/index-abc.js')).toEqual({
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    })
    expect(headersFor(rules, '/sw.js')['cache-control']).toBe('no-cache')
    expect(headersFor(rules, '/index.html')['cache-control']).toBeUndefined()
  })
  it('knows the types the app serves', () => {
    expect(contentType('/s/x/manifest.webmanifest')).toBe('application/manifest+json; charset=utf-8')
    expect(contentType('/assets/a.woff2')).toBe('font/woff2')
    expect(contentType('/x.unknown')).toBe('application/octet-stream')
  })
})
