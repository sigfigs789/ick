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
   number out of ten and a tier, from Common up to Legend.
4. Your best word and your total go on the board, and every word anybody found
   shows up in the finds feed. Tabs across the top: **Play**,
   **Words found**, **Stats** (once you have played), and **Leaderboards**.

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
- **The chat.** A message you post goes to the room of the puzzle you are on,
  under your handle, for every player to read; a message you report goes to the
  server so it can be reviewed. Who you block stays on the device. See
  `src/components/ChatSheet.tsx` and the repo's `src/game/chatModeration.ts`.
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

### The one step that has to be interactive

The very first iOS build needs an Apple Distribution certificate and an App
Store provisioning profile, and EAS cannot create either without talking to
Apple as you. In a non-interactive run it stops before doing any work:

```
✔ Using remote iOS credentials (Expo server)
Distribution Certificate is not validated for non-interactive builds.
Credentials are not set up. Run this command again in interactive mode.
```

So the first build is run by hand, from a terminal that can answer a prompt.
Every command in this file is run from this directory, `native/`:

```bash
npx eas-cli build --platform ios --profile production
```

Note that `eas login` is not part of this and should not be run for it: that is
the *Expo* account, which is already set (see `owner` in `app.json`) and has
nothing to do with Apple. The Apple ID is asked for by the build itself.

It asks for the Apple ID, then a two-factor code from a trusted device, and
offers to register the bundle identifier and generate the credentials. Say yes
to all of it. What it makes is stored on EAS against this project, so this is a
once-per-account step rather than a once-per-build one -- every build after it
can run unattended, including from CI.

Submission is separate and never needs the password. Generate an App Store
Connect API key (Users and Access -> Integrations -> App Store Connect API,
access **App Manager**), and point `eas submit` at it:

```bash
export EXPO_ASC_API_KEY_PATH=/path/to/AuthKey_XXXXXXXX.p8
export EXPO_ASC_KEY_ID=XXXXXXXX
export EXPO_ASC_ISSUER_ID=00000000-0000-0000-0000-000000000000
npx eas-cli submit --platform ios --latest
```

Environment variables rather than `eas.json` fields deliberately: the key is a
credential, and the three values that identify it have no business in a tracked
file. Apple allows the `.p8` to be downloaded exactly once, so keep it
somewhere durable.

### Before the first submission

These are the things that are not decided by any file in this repo, and each one
needs an account rather than a commit:

- ~~**`eas init`**~~ — done. The project is
  [`@sigfigs789/wordink`](https://expo.dev/accounts/sigfigs789/projects/wordink),
  and `app.json` carries its `owner` and `extra.eas.projectId`. It sits on the
  personal account rather than `sigfigs789s-team`, which is the team Expo
  creates alongside one; a project can be transferred between accounts from
  expo.dev if that ever needs to change.
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
- **Age rating.** The chat is user-generated content, with filtering, report,
  block and an agree-to-the-rules screen before the first open; see "Age
  rating" in `store/app-store.md` for the answers and what backs each one.

### Version numbers

The marketing version both stores show is always `1.X`, where `X` is the
website's `APP_VERSION` in the repo root's `src/version.ts`. It is not written
anywhere by hand: `app.config.js` reads that constant and sets `version` on top
of `app.json`, so a build is stamped with the website release it was cut from.
Comparing the version in the stores with the one live on wordink.app shows how
many web releases the app is behind.

iOS `buildNumber` and Android `versionCode` are the build counters, and the
`production` profile has `autoIncrement` on, so EAS advances them. Several
builds can share one `1.X`; once a `1.X` is live in a store, though, the next
submission needs a new one, so a native-only fix waits for (or brings about) a
web bump.

Only `APP_VERSION` feeds the store version. `MIN_VERSION`, the website's
forced-reload floor for open browser tabs, is a mechanism an installed app does
not have and does not need. Its counterpart here is `MIN_RANKED_VERSION`, below.

### Staying on the current rules

The leaderboard ranks whatever total a client priced, so an app on old scoring
rules would rank against the website on different terms. Three things keep that
from happening:

- **The floor.** Every submission carries the client's `APP_VERSION`, and the
  server writes anything below `MIN_RANKED_VERSION` (`src/version.ts`) -- or
  with no version, as builds before 8 send -- as unranked. It still plays, and
  its finds still reach the feed. Raise the floor with `APP_VERSION` only when a
  release changes how a live or coming puzzle is priced.
- **Over-the-air updates.** `expo-updates` ships the JavaScript -- which is the
  whole game -- without a store review. Updates go out on request only, never
  on merge: run the "Native OTA update" action
  (`.github/workflows/native-update.yml`, needs an `EXPO_TOKEN` secret), which
  typechecks, checks the runtime label, and publishes the chosen branch to the
  `production` channel. Builds pick it up on launch, and a build that finds
  itself below the floor pulls it and reloads at once
  (`src/hooks/useUpdateCheck.ts`) -- so raise `MIN_RANKED_VERSION` and run the
  action together.
- **The banner.** When a build is below the floor and no update can close the
  gap, Play and Leaderboards say so, with a button that tries the
  over-the-air update again and falls back to the store listing
  (`src/components/UpdateBanner.tsx`).

An update reaches only builds with the same `runtimeVersion`, a label set by
hand in `app.json` (currently `"1"`). It is not Expo's `"fingerprint"` policy:
that hashed the native layer differently on the EAS build machine than locally
and in CI, so build 10 embedded one runtime while updates were published to
another, and none could reach it.

The label has to change exactly when the native layer does -- a new Expo
module, a permission, an SDK bump, a config plugin. `tools/check-native-fingerprint.cjs`
enforces that: it fingerprints the native layer (`fingerprint.config.js` skips
the store version) and compares it with `native-fingerprint.json`. CI and the
update workflow both fail when the fingerprint moved and the label did not.
The fix is to raise `runtimeVersion`, run
`node tools/check-native-fingerprint.cjs --write`, and ship a store build.
Until players install it, the old builds keep their last update and the banner
covers the gap.
