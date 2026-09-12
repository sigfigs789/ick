# WordInk on Reddit

The Reddit build of the game, on Reddit's Developer Platform (Devvit).

It is a separate npm project on purpose. The website keeps shipping from the
repo root to Vercel exactly as before; this directory adds a second front-end
over the same game core. `src/client/game.tsx` imports `App` from `../../../src`
rather than copying it, so the puzzle, the scoring, and the dictionary cannot
drift between the two. What differs is everything around the game.

## How a Reddit game differs from the website

The unit of play is a **post**, not a URL. Reddit hosts the whole app -- there
is no Vercel in the picture and no outbound network except domains declared in
`devvit.json`. A player opens a post, sees `splash.html`, taps it, and
`game.html` loads in a sandboxed webview. The server in `src/server` is Reddit's
own serverless Node runtime, with Redis beside it.

## What still has to be built

The scaffold builds and renders the real game. None of the seam below exists
yet, and each item is a thing the website gets from the browser that a post has
to supply instead.

- **The three Vercel functions become Hono routes.** `api/leaderboard.ts`,
  `api/validate.ts`, and `api/events.ts` move to `src/server/routes/`. Supabase
  and Merriam-Webster are outbound HTTP and need declaring in `devvit.json`, or
  replacing: the leaderboard is a natural fit for Redis sorted sets.
- **Identity comes from Reddit.** `src/game/player.ts` mints a UUID into
  localStorage and `handleFor` derives a display name from it. Inside a post the
  server knows the actual username. Better boards, but it retires the UUID
  scheme and every Supabase row keyed by one.
- **Progress cannot live in localStorage.** The webview's storage is per-device
  and not guaranteed across sessions. Streaks, past-puzzle history, and
  `src/game/visits.ts` belong in Redis under the username.
- **The post is the puzzle.** The website derives the drop from the player's
  local date against `src/data/drops.json`. Here a scheduled job creates one
  post per day and that post carries its drop -- which removes the clock
  arithmetic rather than porting it.
- **Routing has no server.** `src/routes.ts` leans on the `vercel.json` rewrite
  to `index.html`. There is no rewrite layer here; the five pages need hash or
  in-memory routing.
- **Vercel Analytics and Speed Insights come out**, along with the `sendBeacon`
  in `src/analytics.ts` -- all of it calls domains that will not be allowlisted.

## The bundle

`npm run build` currently produces a 5.8 MB `game.js`, 1.6 MB gzipped. Nearly
all of it is `dictionary.json` (2.9 MB) and `rarity.json` (1.1 MB), which
`src/game/dictionary.ts` imports statically. That is a lot to push through an
iframe in a mobile feed before the first render. The two ways out are moving
validation and scoring to the server behind Redis, or splitting the data into
fetched chunks. This needs deciding before anything is published.

## Running it

`npm run build` works offline. Everything past that needs a Reddit developer
account, an app registered on the portal, and a test subreddit under 200
subscribers to install into:

    npm run login          # devvit login
    npm run dev            # devvit playtest r/<your-test-sub>
    npm run deploy         # typecheck, lint, devvit upload
    npm run launch         # upload, then devvit publish for review

`upload` puts the app where only you can see it. `publish` files it for human
review by Reddit.
