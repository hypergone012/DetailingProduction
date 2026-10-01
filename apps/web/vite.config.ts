import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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

export default defineConfig({
  plugins: [
    studioShells(),
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
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
})
