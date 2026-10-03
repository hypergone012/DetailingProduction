/// <reference lib="webworker" />
/**
 * Service worker (vite-plugin-pwa, injectManifest). Caching policy:
 *   - app shell (JS/CSS/fonts/index.html): precached, versioned by the build;
 *   - navigations: network first, offline falls back to the cached shell;
 *   - PUBLIC data only: studio media from the public bucket (cache first) and the public
 *     studio bootstrap/manifest (stale-while-revalidate);
 *   - everything private (profile, bookings, tokens, owner data, signed URLs, auth): never
 *     cached — NetworkOnly, so nothing personal outlives a "forget device"/logout.
 */
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies'

declare let self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

const pages = new NetworkFirst({ cacheName: 'dp-pages', networkTimeoutSeconds: 4, plugins: [new ExpirationPlugin({ maxEntries: 40 })] })
registerRoute(
  new NavigationRoute(
    async (options) => {
      try {
        const res = await pages.handle(options)
        if (res) return res
      } catch {
        /* offline */
      }
      return (await matchPrecache('/index.html')) ?? Response.error()
    },
    // On a single-origin server the API shares the site's address: opening an API URL (a
    // calendar file, an auth link) is never a page to cache or replace with the app shell.
    { denylist: [/^\/(functions|rest|auth|storage)\/v1\//] },
  ),
)

registerRoute(
  ({ url }) => url.pathname.includes('/storage/v1/object/public/public-media/'),
  new CacheFirst({ cacheName: 'dp-public-media', plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 30 * 86400 })] }),
)

// Public studio data: /functions/v1/public-api/t/<slug> and its manifest. Nothing else.
const studioData = ({ url, request }: { url: URL; request: Request }) =>
  request.method === 'GET' && /\/functions\/v1\/public-api\/t\/[a-z0-9-]+(\/manifest\.webmanifest)?$/.test(url.pathname)
const studioCache = { cacheName: 'dp-public-api', plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 86400 })] }
// The owner cabinet asks for fresh data (`cache: 'no-cache'`) so its own edits show at once.
registerRoute((o) => studioData(o) && o.request.cache === 'no-cache', new NetworkFirst({ ...studioCache, networkTimeoutSeconds: 6 }))
registerRoute(studioData, new StaleWhileRevalidate(studioCache))

registerRoute(
  ({ url }) => /\/(functions|rest|auth|storage)\/v1\//.test(url.pathname),
  new NetworkOnly(),
  'GET',
)

self.addEventListener('message', (event) => {
  const type = (event.data as { type?: string } | null)?.type
  if (type === 'SKIP_WAITING') void self.skipWaiting()
  if (type === 'CLEAR_PRIVATE') {
    // Defensive: private data is never cached, but drop anything not on the public allowlist.
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.filter((k) => !/^(workbox-precache|dp-public-media|dp-public-api|dp-pages)/.test(k)).map((k) => caches.delete(k)))),
    )
  }
})

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
}

self.addEventListener('push', (event) => {
  let data: PushPayload
  try {
    data = (event.data?.json() as PushPayload) ?? {}
  } catch {
    data = { title: 'Уведомление', body: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Уведомление', {
      body: data.body,
      tag: data.tag,
      data: { url: data.url ?? '/' },
      badge: undefined,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data as { url?: string } | null)?.url ?? '/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const w of windows) {
        if (new URL(w.url).pathname.split('/').slice(0, 3).join('/') === new URL(target).pathname.split('/').slice(0, 3).join('/')) {
          await w.focus()
          await (w as WindowClient).navigate(target)
          return
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})
