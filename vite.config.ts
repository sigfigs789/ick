/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { APP_VERSION, MIN_VERSION } from './src/version'

// Serves the api/ edge functions during `npm run dev`. In production those files
// are Vercel Edge Functions, which `vite dev` knows nothing about -- without this
// the live Merriam-Webster fallback and the analytics mirror both 404 locally and
// neither can be exercised outside a deploy. Dev only (`apply: 'serve'`);
// production routing comes from vercel.json.
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
  method?: string
  headers: Record<string, string | string[] | undefined>
  /** IncomingMessage is an async iterable of body chunks; see readBody. */
  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array>
}
interface DevResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body: string): void
}

/** The dev-served endpoints, mapped to the module that answers each. */
const DEV_API_ROUTES: Record<string, string> = {
  '/api/validate': '/api/validate.ts',
  '/api/events': '/api/events.ts',
  '/api/leaderboard': '/api/leaderboard.ts',
}

/** Collect a request body, which /api/events needs and /api/validate ignores. */
async function readBody(req: DevRequest): Promise<string> {
  const decoder = new TextDecoder()
  let body = ''
  for await (const chunk of req) body += decoder.decode(chunk, { stream: true })
  return body + decoder.decode()
}

/** Node's header bag allows repeats; the Fetch Request wants single values. */
function singleValueHeaders(req: DevRequest): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[name] = value
    else if (Array.isArray(value) && value.length > 0) headers[name] = value[0]
  }
  return headers
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
        const modulePath = DEV_API_ROUTES[path]
        if (!modulePath) return next()
        void (async () => {
          try {
            const module = await server.ssrLoadModule(modulePath)
            const handler = module.default as (request: Request) => Promise<Response>
            const method = (req.method ?? 'GET').toUpperCase()
            const headers = singleValueHeaders(req)
            // Built from the Host header rather than a fixed origin so a
            // same-origin check inside a handler sees the port the browser
            // actually used (see api/events.ts).
            const host = headers.host ?? 'localhost'
            const hasBody = method !== 'GET' && method !== 'HEAD'
            const response = await handler(
              new Request(new URL(req.url ?? '/', `http://${host}`), {
                method,
                headers,
                ...(hasBody ? { body: await readBody(req) } : {}),
              }),
            )
            res.statusCode = response.status
            response.headers.forEach((value, key) => res.setHeader(key, value))
            res.end(await response.text())
          } catch (error) {
            // Surface a dev-server failure as /api/validate's own error shape so
            // the client treats it like any other failed lookup. /api/events
            // never reads its response, so the shape is harmless there.
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
    alias: {
      // The Devvit tests live in this suite but their dependency tree does not:
      // devvit/ keeps its own node_modules and CI installs only the root's. The
      // tests mock this module anyway; the stub exists so the import resolves.
      // See devvit/tests/devvit-server-stub.ts.
      '@devvit/web/server': new URL(
        './devvit/tests/devvit-server-stub.ts',
        import.meta.url,
      ).pathname,
    },
  },
})
