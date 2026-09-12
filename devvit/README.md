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

## What is built

- **The leaderboard**, on Reddit's own Redis (`src/server/core/leaderboard.ts`).
  The website derives every board from its rows on each read; Redis has no
  `GROUP BY`, so the aggregation happens at write time and `submitScores` is the
  only writer. Its arithmetic is under test in `tests/leaderboard.test.ts`.
- **Identity from the post.** The server asks Reddit who is calling and ignores
  the `player` query parameter and the `playerId` in the POST body that the
  website takes. A client that names itself on a board it competes in is a
  client that can name somebody else.
- **The live word check, without Merriam-Webster** (`src/server/core/verdicts.ts`).
  The website's keys are free non-commercial ones capped at 1,000 requests a day
  for the whole game, which a Reddit audience would exhaust. So this build never
  calls Merriam-Webster: it reads the verdicts the website has already collected,
  through the `20260911070000` migration, cached read-through in Redis. A word
  the site has judged is known here; one it has not is `unknown`, which is what
  the client already does with a word Merriam-Webster cannot find.
- **One board holding both games.** The website's aggregate is pulled in on a
  schedule (`src/server/core/import.ts`) and cached; Reddit's own scores never
  leave Reddit. Rows carry where they were played and the shared client names
  them `u/` or `w/`. The read-only door they come through is the
  `20260911060000` migration -- the anon key, never the service-role key.

- **One post a day, and the day is the player's own.** A scheduled job puts up
  a post each morning, titled with the day it went up. The post is a doorway to
  the game rather than a container for one puzzle: the game reads the date off
  the device exactly as the website does, so any post opens whatever puzzle it
  is for whoever opens it. `gameDay` in `src/shared/windows.ts` decides the day
  a post goes up, and is ten hours behind UTC so a post is never dated ahead of
  the westernmost player's device.
- **The splash, the icon and the rest of the post's surface.** `splash.css` is
  written in the game's own palette rather than the template's Tailwind, because
  most people scrolling past will see only that. It says nothing about the day's
  drop -- not knowing the letters until you open it is the game, which is also
  why the post's title is the date.
- **Nothing is reported from inside a post.** Vercel's scripts are blocked by
  the frame's content policy and `/api/events` is a path this build does not
  serve, so every event would be a blocked script and a request into nothing --
  and reporting what Reddit's players do to a third party is the one thing this
  build is careful not to do anywhere else. The seam is `setReporting` in
  `src/analytics.ts`, on everywhere but here.

## What still has to be built

- **Progress still lives in localStorage**, and the leaderboard does not cover
  it. The board holds one summary row per player per puzzle -- the day's rarest
  word and its totals -- which is what a board needs and not what a *game*
  needs: the guesses in flight, the streak, and which days have been played are
  none of them in it. In a webview that storage is per-device, so a player
  moving between the Reddit app on a phone and Reddit on a desktop starts again
  with no streak. Not a blocker for publishing; it is the largest quality gap
  that remains.
- **`/api/events`.** The analytics mirror, which has no reader and so is the
  least urgent thing here.
- **Routing has no server.** `src/routes.ts` leans on the `vercel.json` rewrite
  to `index.html`. There is no rewrite layer here; the five pages need hash or
  in-memory routing.
- **The bundle is being shipped as it is** -- 5.8 MB, 1.6 MB gzipped, almost all
  of it the dictionary. A deliberate call rather than an oversight; see below.

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

## Settings the import needs

The merged board is dormant until both are set; without them the app shows
Reddit's own players, which is a working board.

    devvit settings set supabaseUrl        # defaults to the live project already
    devvit settings set supabaseAnonKey    # the anon key -- NOT service-role

The `20260911060000` and `20260911070000` migrations have to be applied to the
website's Supabase first, or the anon key has nothing it may call. `permissions.http.domains` names the live project's host exactly
(`hjjdnbftdwswkfqnsejt`, the us-east-2 one -- the older us-east-1 project of the
same name holds none of these tables).

One thing to expect from the word check rather than be surprised by: the site
had judged 31 words when this was written, because the live fallback only fires
for a word the curated dictionary does not already carry. So a novel word on
Reddit will almost always come back `unknown` and the game's own rejection will
stand. The mechanism is right and the table fills as the site is played, but the
benefit today is small.
