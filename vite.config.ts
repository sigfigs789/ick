/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { APP_VERSION, MIN_RANKED_VERSION, MIN_VERSION } from './src/version'
// @ts-expect-error -- Node builtin; this project has no @types/node, but the
// config runs under Node.
import { createHash } from 'node:crypto'
// @ts-expect-error -- as above.
import { readFileSync } from 'node:fs'

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

/*
 * Turn the developer affordances on for a Vercel *preview* deploy -- the branch
 * build opened from a pull request -- and leave them off for production.
 *
 * VERCEL_ENV is Vercel's own build-time variable ("production", "preview" or
 * "development"). It is not VITE_-prefixed, so it never reaches the browser by
 * itself; this copies the one bit of it that matters into a variable that does.
 * Set here at module scope, before Vite reads the environment, so it lands in
 * `import.meta.env` the same way a .env entry would. A local `npm run build` has
 * no VERCEL_ENV and so builds exactly like production, which is what makes it a
 * usable rehearsal of one.
 *
 * See src/dev/devTools.ts for what reads it, and why it is read off
 * `import.meta.env` rather than a defined global.
 */
if (process.env.VERCEL_ENV === 'preview') process.env.VITE_DEV_TOOLS = '1'

/*
 * A fingerprint of the corpus files under public/corpus/, for the client to put
 * on their URLs (see loadCorpus in src/game/corpus.ts).
 *
 * The corpus is 3.6MB gzipped and is served from public/, so Vite does not hash
 * its file names. Keyed by APP_VERSION instead, it was downloaded afresh on
 * every release -- near daily -- though it changes a few times a year. Keyed by
 * its own contents, a returning player keeps it until it actually changes, and
 * the files the client fetches still move together: a rebuilt corpus changes the key on all
 * of them at once. Computed here, from the files being deployed, so it cannot
 * drift from them the way a committed hash could.
 */
const CORPUS_FILES = ['meta.json', 'words.txt', 'tags.bin', 'sources.bin', 'zipf-attested.bin']
const corpusHash = createHash('sha256')
for (const name of CORPUS_FILES) corpusHash.update(readFileSync(`public/corpus/${name}`))
process.env.VITE_CORPUS_VERSION = corpusHash.digest('hex').slice(0, 16)

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
  '/api/chat': '/api/chat.ts',
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
      // Same guard for the ranking floor: above the release, no client ranks.
      if (MIN_RANKED_VERSION > APP_VERSION) {
        this.error(
          `MIN_RANKED_VERSION (${MIN_RANKED_VERSION}) must not exceed APP_VERSION (${APP_VERSION}) — ` +
            `no client could rank. Fix src/version.ts.`,
        )
      }
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({
          version: APP_VERSION,
          minVersion: MIN_VERSION,
          minRankedVersion: MIN_RANKED_VERSION,
        }),
      })
    },
  }
}

/*
 * Which chunk a module lands in, so the bundle is several files rather than one.
 *
 * The word data under src/data/ is most of the download (the dictionary,
 * rarity and estimate files alone run to megabytes), and before this it was
 * baked into the same file as the app's code. Any deploy -- a copy tweak, one
 * new score override -- changed that file's hash, and every returning player
 * downloaded all of it again. One chunk per data file means a deploy only
 * invalidates the files it actually touched, and the browser fetches the
 * chunks in parallel (Vite emits a modulepreload for each).
 *
 * React gets a chunk of its own for the same reason: it changes only when the
 * dependency is bumped. Only react, react-dom and scheduler -- every other
 * package stays where Rollup puts it, which keeps the lazily loaded emoji
 * picker out of the first load.
 */
function chunkFor(id: string): string | undefined {
  // Claude's Zipf estimates are one file per batch for the same reason, one
  // level further down: the daily run only ever adds a batch, so it adds one
  // small chunk and leaves the megabytes of earlier batches cached.
  const batch = id.match(/\/src\/data\/estimated-zipf\/([^/]+)\.json$/)
  if (batch) return `data-estimated-zipf-${batch[1]}`
  const data = id.match(/\/src\/data\/([^/]+)\.json$/)
  if (data) return `data-${data[1]}`
  if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
  return undefined
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), emitVersionJson(), serveApiFunctions()],
  // Emit each JSON import as `JSON.parse("...")` rather than an object literal.
  // Engines parse a JSON string faster than the same data as JavaScript (about
  // a fifth faster for the estimated-Zipf data, measured cold in Node), and with
  // megabytes of word data that is time a phone spends before the puzzle can
  // appear. Every data
  // import in src/ is a default import, which is all this mode supports.
  json: { stringify: true },
  // vercel.json serves everything under /assets/ as `immutable` for a year,
  // which is only safe because Vite names every file there by its content hash.
  // Nothing else may live there: a file put in public/assets/ would keep its
  // name across deploys and be cached, stale, for that long. (vercel.json is
  // plain JSON, so the note lives here.)
  build: {
    rollupOptions: {
      output: { manualChunks: chunkFor },
    },
  },
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
