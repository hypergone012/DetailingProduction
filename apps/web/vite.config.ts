import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { astryxSlim } from './vite/astryx-slim.ts'
import { purgeStylex } from './vite/purge-stylex.ts'

// One build serves every studio. Tenant identity (title, manifest, icons, theme) is
// resolved at runtime from /s/:slug and, for crawlers and installs, by the per-tenant
// HTML shells that `pnpm tenant:shells` writes next to this build.
/**
 * `vite preview` with the same rewrites as the generated _redirects: a studio path serves
 * that studio's shell when it exists, so local preview behaves like the production host.
 */
function studioShells(): Plugin {
  return {
    name: 'dp-studio-shells',
    configurePreviewServer(server) {
      const dist = server.config.build.outDir
      server.middlewares.use((req, _res, next) => {
        const m = /^\/s\/([a-z0-9-]+)(\/owner)?(?:\/[^?]*)?(\?.*)?$/.exec(req.url ?? '')
        const accept = req.headers.accept ?? ''
        if (m && req.method === 'GET' && accept.includes('text/html')) {
          const shell = `/s/${m[1]}${m[2] ?? ''}/index.html`
          if (existsSync(join(dist, shell))) req.url = shell
        }
        next()
      })
    },
  }
}

/**
 * Preloads the Cyrillic subset of the UI font (almost all text): otherwise the browser only
 * finds it after downloading and parsing the stylesheet, and text paints late. The other
 * subsets load on demand, leaving the bandwidth to the app code.
 */
function preloadFonts(): Plugin {
  return {
    name: 'dp-preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const fonts = Object.keys(ctx.bundle ?? {}).filter((f) => /onest-cyrillic-wght-normal-[^/]+\.woff2$/.test(f))
        return fonts.map((f) => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${f}`, crossorigin: '' }, injectTo: 'head' as const }))
      },
    },
  }
}

/**
 * The client app and the owner cabinet are separate chunks loaded after the entry runs. The page
 * knows from its URL which one it needs, so it preloads that chunk and its imports right away,
 * in parallel with the entry, instead of discovering them one round trip later.
 */
function preloadAppChunks(): Plugin {
  return {
    name: 'dp-preload-app-chunks',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const chunks = Object.values(ctx.bundle ?? {}).filter((c) => c.type === 'chunk')
        const byName = new Map(chunks.map((c) => [c.fileName, c]))
        const entry = chunks.find((c) => c.isEntry)
        const loaded = new Set<string>()
        const walk = (file: string, into: Set<string>) => {
          if (into.has(file)) return
          into.add(file)
          for (const dep of byName.get(file)?.imports ?? []) walk(dep, into)
        }
        if (entry) walk(entry.fileName, loaded)
        const app = (re: RegExp) => {
          const chunk = chunks.find((c) => c.facadeModuleId && re.test(c.facadeModuleId))
          const files = new Set<string>()
          if (chunk) walk(chunk.fileName, files)
          return [...files].filter((f) => !loaded.has(f))
        }
        const client = app(/features\/client\/ClientApp\.tsx$/)
        const owner = app(/features\/owner\/OwnerApp\.tsx$/)
        if (!client.length && !owner.length) return []
        const code = `(function(){var m=/^\\/s\\/[a-z0-9-]+(\\/owner(?:\\/|$))?/.exec(location.pathname);if(!m)return;(m[1]?${JSON.stringify(owner)}:${JSON.stringify(client)}).forEach(function(f){var l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href='/'+f;document.head.appendChild(l)})})()`
        return [{ tag: 'script', children: code, injectTo: 'head' as const }]
      },
    },
  }
}

export default defineConfig({
  plugins: [
    studioShells(),
    preloadFonts(),
    preloadAppChunks(),
    astryxSlim(fileURLToPath(new URL('./src', import.meta.url))),
    purgeStylex(),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: null,
      registerType: 'prompt',
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,woff2,svg}', 'index.html'],
        globIgnores: ['s/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rolldownOptions: {
      // Icons used across screens would otherwise become dozens of 1 KB files (one request each).
      output: { codeSplitting: { groups: [{ name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/ }] } },
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
})
