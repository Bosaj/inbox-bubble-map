import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { VitePWA } from 'vite-plugin-pwa'

/** Serve the /api/* Vercel Functions (nested paths too) during `npm run dev`. */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/api\/([a-z][a-z/-]*?)(\?.*)?$/.exec(req.url ?? '')
        if (!m) return next()
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const mod = (await server.ssrLoadModule(`/api/${m[1]}.ts`)) as Record<string, (r: Request) => Promise<Response>>
        const handler = mod[req.method ?? 'GET']
        if (!handler) return next()
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const response = await handler(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: req.method === 'POST' || req.method === 'DELETE' ? Buffer.concat(chunks) : undefined, redirect: 'manual' }))
        res.statusCode = response.status
        response.headers.forEach((v, k) => k !== 'set-cookie' && res.setHeader(k, v))
        const cookies = response.headers.getSetCookie()
        if (cookies.length) res.setHeader('set-cookie', cookies)
        res.end(Buffer.from(await response.arrayBuffer()))
      })
    },
  }
}

/**
 * Preload the latin fonts the first screen uses (Geist + Instrument Serif), so the
 * headline doesn't reflow when the web font arrives (layout shift on slow phones).
 */
function preloadFonts(): Plugin {
  return {
    name: 'preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const fonts = Object.keys(ctx.bundle ?? {}).filter((f) => /(geist-latin-wght-normal|instrument-serif-latin-400-(normal|italic))-[\w-]+\.woff2$/.test(f))
        return { html, tags: fonts.map((f) => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${f}`, crossorigin: '' }, injectTo: 'head' as const })) }
      },
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    devApi(),
    preloadFonts(),
    VitePWA({
      registerType: 'autoUpdate',
      pwaAssets: { config: true },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Inbox Bubble Map',
        short_name: 'Bubble Map',
        description: 'See who fills your inbox as a bubble map, then read, unsubscribe, archive or trash in a click. Gmail, Outlook and any IMAP account.',
        theme_color: '#4a3aa7',
        background_color: '#f4f2ee',
        display: 'standalone',
        start_url: '/',
        categories: ['productivity', 'utilities'],
      },
      workbox: {
        // the app shell works offline; mail, sign-in and relays always go to the network
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/redirect\.html/],
        maximumFileSizeToCacheInBytes: 3_000_000,
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), redirect: resolve(__dirname, 'redirect.html') },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
})
