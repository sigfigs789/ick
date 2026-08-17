/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { APP_VERSION, MIN_VERSION } from './src/version'

// Serves api/validate.ts during `npm run dev`. In production that file is a
// Vercel Edge Function, which `vite dev` knows nothing about -- without this the
// live Merriam-Webster fallback 404s locally and the feature can't be exercised
// outside a deploy. Dev only (`apply: 'serve'`); production routing comes from
// vercel.json.
//
// The handler reads its keys off `process.env`, so .env is loaded into it here
// (Vite otherwise only exposes VITE_-prefixed vars to the client -- these keys
// are deliberately not VITE_-prefixed, so they never reach the browser).
// Declared locally rather than depending on @types/node, which this project
// doesn't install. Only the two members used below.
declare const process: { env: Record<string, string | undefined>; cwd(): string }

/** The bits of the Node request/response the middleware below actually touches. */
interface DevRequest {
  url?: string
}
interface DevResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body: string): void
}

function serveApiFunctions(): Plugin {
  return {
    name: 'serve-api-functions',
    apply: 'serve',
    config(_config, { mode }) {
      // '' prefix loads every var, not just VITE_-prefixed ones.
      Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
    },
    configureServer(server) {
      server.middlewares.use((rawReq, rawRes, next) => {
        const req = rawReq as DevRequest
        const res = rawRes as unknown as DevResponse
        const path = (req.url ?? '').split('?')[0]
        if (path !== '/api/validate') return next()
        void (async () => {
          try {
            const module = await server.ssrLoadModule('/api/validate.ts')
            const handler = module.default as (request: Request) => Promise<Response>
            const response = await handler(
              new Request(new URL(req.url ?? '/', 'http://localhost')),
            )
            res.statusCode = response.status
            response.headers.forEach((value, key) => res.setHeader(key, value))
            res.end(await response.text())
          } catch (error) {
            // Surface a dev-server failure as the endpoint's own error shape so
            // the client treats it like any other failed lookup.
            res.statusCode = 500
            res.setHeader('content-type', 'application/json')
            res.end(
              JSON.stringify({
                outcome: 'error',
                reason: 'dev-server-error',
                detail: error instanceof Error ? error.message : String(error),
                zipf: null,
                pos: [],
                firstUse: null,
              }),
            )
          }
        })()
      })
    },
  }
}

// Emits dist/version.json from the committed version constants so the served
// file can never drift from what's baked into the bundle. Open tabs poll this
// file to decide whether they must reload. See src/version.ts and
// src/hooks/useForceUpdate.ts.
function emitVersionJson(): Plugin {
  return {
    name: 'emit-version-json',
    generateBundle() {
      // Guard against the one config that bricks the app: a floor above the
      // shipped bundle makes even fresh loads reload forever. Fail the build
      // rather than deploy a reload loop.
      if (MIN_VERSION > APP_VERSION) {
        this.error(
          `MIN_VERSION (${MIN_VERSION}) must not exceed APP_VERSION (${APP_VERSION}) — ` +
            `this would force an infinite reload loop for all users. Fix src/version.ts.`,
        )
      }
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({
          version: APP_VERSION,
          minVersion: MIN_VERSION,
        }),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), emitVersionJson(), serveApiFunctions()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
