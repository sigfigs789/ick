# WordInk on Reddit

A daily word game. Every player gets the same two or three letters — say `INK` —
and has four guesses to find the rarest English word containing them, in order:
`thINK`, `wrINKle`, `INKling`. Rarer scores higher, so the game is not "find a
word" but "find the word nobody else thought of". There is no timer and nothing
to buy.

## How a round plays

1. A post goes up each day. Its splash shows the game's name and nothing about
   the day's letters — not knowing them until you open it is the point.
2. Tapping it opens the puzzle. The letters appear, and you enter words that
   contain them.
3. Each accepted word is scored on how rare it is, measured against published
   word-frequency data rather than on length or difficulty.
4. Your best word and your total go on the board. Three tabs across the top:
   **Play**, **Leaderboards**, and **Words found** — everything anybody turned
   up on that day's puzzle.

Archive puzzles are playable from the same post. They do not count towards the
board or the streak, for the obvious reason that the answers are lookupable.

## What it stores, and where

- **On Reddit, under the player's username:** their score for each puzzle, their
  rarest word of that day, and which words they found. This is what the
  leaderboard and the finds feed are built from. It lives in the app's own Redis
  and goes nowhere else.
- **In the player's browser:** the puzzle in progress and their streak.
- **Nothing is reported to any analytics service.** The website this game also
  runs on uses Vercel Analytics; that is switched off in this build, because
  sending what Reddit's players do to a third party is not something this app
  should do.

There is a privacy policy at https://www.wordink.app/privacy.html and terms at
https://www.wordink.app/terms.html.

## Why it asks for what it asks for

- **Outbound HTTP, to one host.** The same game runs at
  [wordink.app](https://www.wordink.app/), and this app reads two things from
  that site's database: the public leaderboard totals, so both sets of players
  can appear on one board, and the dictionary verdicts the website has already
  collected, so this app never has to call Merriam-Webster itself. Both are
  reads. **No Reddit username, and nothing about any Reddit player, is ever sent
  off Reddit.** The only host it contacts is the project's own Supabase
  instance, declared in `devvit.json`.
- **Creating posts, and acting as a moderator.** A scheduled job puts up one
  post a day, which is how the game is played at all. A moderator menu item
  creates one by hand if the schedule is missed.
- **The scheduler.** Two jobs: the daily post, and a periodic refresh of the
  imported leaderboard.

## Trying it

Install it to a test subreddit and a post appears immediately; the moderator
menu also has *"Post today's puzzle"*. Play a word or two and the board fills
in. The app needs two settings before the imported half of the leaderboard has
anything in it — see **Settings the import needs** at the bottom.

---

The rest of this file is about how the port is built, and is aimed at whoever
works on it next.

## How the game is put together

It is a separate npm project on purpose. The website keeps shipping from the
repo root to Vercel exactly as before; this directory adds a second front-end
over the same game core. `src/client/game.tsx` imports `Root` from `../../../src`
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

## The state of the outbound-HTTP grant

The import described above is written and tested but has never fetched
anything: every call is refused before it leaves the app.

    PERMISSION_DENIED: HTTP request to domain: <host> is not allowed

What has been ruled out, each by trying it:

- the hostname -- the exact host and the apex `supabase.co` are both refused;
- the config shape -- it is identical to `reddit/devvit-HotAndCold`, a published
  app that fetches four external domains this way;
- the toolchain -- refused on CLI 0.14.2 and on 0.14.3;
- the settings -- they read back fine; the failure is at `fetch`, after them;
- anything Supabase-specific -- a probe at `raw.githubusercontent.com`, added to
  the allowlist moments earlier, was refused in exactly the same way.

So the allowlist is not being applied to this app at all. The likeliest reading
is that outbound HTTP is granted by Reddit rather than declared by the developer
-- "domains you declared **and Reddit approved**" -- and that an uploaded,
unpublished app has not been granted any. If so it resolves at review, and
nothing here needs changing.

Until then the game is whole without it: Reddit's own board, its own finds feed,
and a word check that answers `unknown` where the website would have asked
Merriam-Webster. What is missing is the website's players merged in.

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
