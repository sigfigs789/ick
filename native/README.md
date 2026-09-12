# WordInk for iOS and Android

A daily word game. Every player gets the same two or three letters — say `INK` —
and has four guesses to find the rarest English word containing them, in order:
`thINK`, `wrINKle`, `INKling`. Rarer scores higher, so the game is not "find a
word" but "find the word nobody else thought of". There is no timer, no account,
and nothing to buy.

## How a round plays

1. The app opens on today's letters. Everybody in the world gets the same ones,
   picked from a fixed list by the date — there is no server deciding it.
2. You type words containing those letters. Wrong guesses are free and
   unlimited; only a word the game accepts spends one of your four.
3. Each accepted word is scored on how rare it is, measured against published
   word-frequency data rather than on length or difficulty. The score is a
   number out of ten and a tier, from Very Common up to Legend.
4. Your best word and your total go on the board, and every word anybody found
   shows up in the finds feed. Three tabs across the top: **Play**,
   **Leaderboards**, and **Words found**.

Old puzzles are playable by stepping back with the arrows. They do not count
towards the board or the streak, for the obvious reason that the answers are
lookupable by then.

## What it stores, and where

- **On the device.** The puzzle in progress, every day you have played, your
  streak, and a random identifier this install invented for itself. Nothing
  here is typed by the player and nothing identifies them; the name on the
  leaderboard is computed from that random identifier (see
  `src/game/handle.ts`).
- **Sent to the game's server**, at `wordink.app`: your score for a puzzle, your
  rarest word, and the words you found — under that random identifier. This is
  what the leaderboard and the finds feed are built from, and it is the feature.
  A word you type that the curated list does not carry is also sent, to be
  looked up in a dictionary the site keeps (`/api/validate`).
- **Sent only when you ask for it.** A word you type into "Suggest a word", or a
  note you type into the feedback box. These are the two things the app sends
  because you pressed a button that says it will. See `src/host/submissions.ts`.
- **No analytics.** The website reports gameplay events to Vercel Analytics and
  to its own database. This build calls `setReporting(false)` before the first
  render and sends none of it — see `src/host/install.ts`. The Reddit build makes
  the same call for the same reason.
- **No permissions.** The app requests none: no camera, no location, no
  contacts, no notifications, no tracking identifier.

Privacy policy: https://www.wordink.app/privacy.html —
terms: https://www.wordink.app/terms.html

## How this project is put together

This is a front-end, not a fork. The game itself — the 200,000-word curated
dictionary, the rarity scoring, the fold that stops `asphyxiates` outscoring
`asphyxiate`, the storage format, the leaderboard client, and the hook that
drives a day's play — is the repo's own `src/`, **imported rather than copied**.
The same arrangement the Reddit build uses (see `devvit/`), and for the same
reason: two copies of a word game's rules drift, and the drift is invisible
until two players disagree about a score.

What is written here is the view layer, and only that. Roughly:

| | |
| --- | --- |
| `src/host/` | Everything that differs between a phone and a browser, applied once before the first render. |
| `src/theme/` | The website's palette as values instead of CSS custom properties. |
| `src/components/`, `src/screens/` | The game, drawn with React Native views. |
| `metro.config.js`, `babel.config.js`, `tools/` | Teaching the bundler to build from two roots. |

### The four things a phone does not have

The shared code is written against the web's primitives. Rather than edit it for
the benefit of one host, the host supplies them:

- **`localStorage`.** The game's persistence is five modules calling it
  synchronously, several of them during render. `src/host/storage.ts` supplies a
  real one over `expo-sqlite`'s synchronous key-value store — including the
  `ownKeys` trap that `Object.keys(localStorage)` needs, which is what the
  leaderboard's history import is built on.
- **A page for `/api/...` to be relative to.** `src/host/net.ts` wraps `fetch`
  so root-relative paths resolve against the site. There is no separate app
  backend and there should not be one: it is deliberately one leaderboard across
  every front-end the game has.
- **`import.meta.env`.** Vite answers it; Metro emits CommonJS, where
  `import.meta` is a syntax error. `tools/babel-plugin-import-meta-env.cjs`
  rewrites it, narrowly.
- **The Web Audio API.** The website answers a guess with a synthesised chime.
  `src/host/feedback.ts` answers with haptics instead — most phones are on
  silent, and touch is the channel that works anyway.

### What is deliberately different

- **One share button, not two.** The system share sheet already lists every
  destination the player has. The website's separate "post to X" button was a
  shortcut past a sheet that no longer needs shortcutting.
- **No router.** The website has real URLs because two of its pages are pages
  you link someone to. None of that exists here, so the route is a piece of
  state and the tabs are the whole of the navigation.
- **No curator pages.** The website's word queue and feedback list are reached
  by typing a URL with a key in it. There is no URL to type.

## Running it

```bash
npm install
npm run ios      # or: npm run android
```

Works in Expo Go — every native module it uses ships with the SDK. Metro watches
the repo root as well as this folder, so an edit to the dictionary or the scoring
reaches a running app the same way an edit to a screen does.

```bash
npm run typecheck   # tsc over this project and everything it imports
npm run lint
npm run bundle      # production bundles for both platforms
```

The shared game logic has its own test suite, which is the repo root's: run
`npm test` there. Nothing in this project reimplements a rule, so there is
nothing here for those tests not to cover.

## Shipping it

Builds and submissions go through [EAS](https://docs.expo.dev/build/introduction/).
`eas.json` has three profiles: `development` (a dev client), `preview` (an
internal build — an APK on Android), and `production` (an App Store build and an
Android App Bundle).

```bash
npm install -g eas-cli
eas login
eas build --platform ios --profile production
eas build --platform android --profile production
eas submit --platform ios --latest
eas submit --platform android --latest
```

### Before the first submission

These are the things that are not decided by any file in this repo, and each one
needs an account rather than a commit:

- **`eas init`**, which mints the project id `app.json` will carry.
- **An Apple Developer account** ($99/yr) and an App Store Connect app record
  with the bundle identifier `app.wordink`. EAS can create the signing
  credentials.
- **A Google Play Developer account** ($25 once) and an app with the package name
  `app.wordink`. `eas submit` wants a service-account key JSON.
- **Store listing copy, and screenshots.** The first section of this file is
  written to be the listing description. Screenshots have to come from a real
  run — take them on the largest iPhone and a tablet, since Apple asks for both.
- **The privacy questionnaires.** Both stores ask what the app collects. The
  answer is in "What it stores, and where" above; the short version is a random
  per-install identifier tied to game scores, no tracking, no third-party
  analytics, and no advertising identifier.
- **Age rating.** No user-generated content is displayed except other players'
  found words, which come from a curated dictionary.

### Version numbers

`app.json`'s `version` is the marketing version both stores show. iOS
`buildNumber` and Android `versionCode` are the build counters, and the
`production` profile has `autoIncrement` on, so EAS advances them.

These are independent of the repo root's `src/version.ts`, which is the
website's forced-reload floor for open browser tabs — a mechanism an installed
app does not have and does not need.
