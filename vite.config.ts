import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

/** Serve the /api/imap Vercel Function during `npm run dev`. */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/imap', async (req, res) => {
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const mod = (await server.ssrLoadModule('/api/imap.ts')) as { POST: (r: Request) => Promise<Response> }
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const response = await mod.POST(new Request(`http://${req.headers.host}/api/imap`, { method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }))
        res.statusCode = response.status
        response.headers.forEach((v, k) => res.setHeader(k, v))
        res.end(Buffer.from(await response.arrayBuffer()))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
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
