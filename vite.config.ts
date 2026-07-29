import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev image proxy with multi-upstream fallback.
 * Free hosts rate-limit and hang; trying a few endpoints cuts batch failures.
 */
function imageGenProxy(): Plugin {
  return {
    name: 'image-gen-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/image-gen/')) {
          next()
          return
        }

        try {
          const incoming = new URL(req.url, 'http://localhost')
          // Path: /api/image-gen/<encoded-prompt>?width=&height=&seed=
          const promptPath = incoming.pathname.replace(/^\/api\/image-gen\//, '')
          const decoded = decodeURIComponent(promptPath)
          const width = incoming.searchParams.get('width') || '512'
          const height = incoming.searchParams.get('height') || '512'
          const seed = incoming.searchParams.get('seed') || '0'
          const q = `width=${width}&height=${height}&seed=${seed}&nologo=true`

          const encoded = encodeURIComponent(decoded)
          // Prefer shorter path hosts first; cascade on failure
          const targets = [
            `https://image.pollinations.ai/prompt/${encoded}?${q}`,
            `https://image.pollinations.ai/prompt/${encoded}?${q}&model=flux`,
            // pollinations.ai/p often returns HTML — last resort only
            `https://image.pollinations.ai/prompt/${encoded}?${q}&model=turbo`,
          ]

          let lastErr = 'no upstream tried'
          for (const target of targets) {
            try {
              const upstream = await fetch(target, {
                headers: {
                  Accept: 'image/*,*/*',
                  'User-Agent': 'pin-proof-studio/0.2',
                },
                // Free tier often takes 35–55s; cut-off too low = mass "failures"
                signal: AbortSignal.timeout(90_000),
              })

              if (!upstream.ok) {
                lastErr = `HTTP ${upstream.status} from ${new URL(target).host}`
                // brief backoff before next host
                await new Promise((r) => setTimeout(r, 400))
                continue
              }

              const buf = Buffer.from(await upstream.arrayBuffer())
              if (buf.length < 800) {
                lastErr = `tiny body from ${new URL(target).host}`
                continue
              }

              const contentType = upstream.headers.get('content-type') || 'image/jpeg'
              // Reject HTML error pages dressed as 200
              if (contentType.includes('text/html')) {
                lastErr = `html body from ${new URL(target).host}`
                continue
              }

              res.statusCode = 200
              res.setHeader('Content-Type', contentType)
              res.setHeader('Cache-Control', 'no-store')
              res.setHeader('X-Image-Upstream', new URL(target).host)
              res.end(buf)
              return
            } catch (err) {
              lastErr =
                err instanceof Error
                  ? err.message
                  : 'upstream error'
              await new Promise((r) => setTimeout(r, 300))
            }
          }

          res.statusCode = 502
          res.setHeader('Content-Type', 'text/plain')
          res.end(`Image proxy failed after fallbacks: ${lastErr}`)
        } catch (err) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'text/plain')
          res.end(
            err instanceof Error
              ? `Image proxy failed: ${err.message}`
              : 'Image proxy failed',
          )
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), imageGenProxy()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
})
