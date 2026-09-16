# App Review notes (Guideline 2.1 — Information Needed)

The text below is what goes in two places, verbatim: the Resolution Center
reply in App Store Connect, and the **Notes** field under App Review
Information, so a future submission carries it without being asked.

Everything here is checkable against this repo: the app is `native/`, the
server it talks to is `api/`, and what it does and does not send is
`native/src/host/install.ts` and `native/src/host/submissions.ts`.

---

## 1. Screen recording

*(Attach a recording captured on a physical device running the current iOS.
Nothing in this repo can produce it — see "What you have to record", below.)*

The app has no account system, no user-generated content that is displayed to
other players, and nothing to buy, so none of the three flows the guideline
asks about appear in the recording. Items 2–6 below explain why in each case.

## 2. Purpose and target audience

WordInk is a daily word game. Every player in the world is given the same two
or three letters — say `INK` — and has four guesses to find the rarest English
word that contains them in order: `thINK`, `wrINKle`, `INKling`.

The twist is what it scores. Most word games reward length or speed. WordInk
scores **rarity**: each accepted word is measured against published English
word-frequency data and given a score out of ten and a tier, from Very Common
up to Legend. So the game is not "find a word", it is "find the word nobody
else thought of" — and the interesting move is usually a word you already know
but would never normally reach for.

The audience is adults and older children who play daily puzzle games —
Wordle, Connections, Spelling Bee. It is one short round a day, with no timer,
no account, no ads, and nothing to buy. The value it provides is the same as
its genre: a small shared puzzle everybody gets the same version of, plus a
vocabulary you can actually see yourself using.

Rated 4+. All content is generated from a curated English dictionary; the
scoring pipeline excludes proper nouns, abbreviations, archaic and obsolete
entries, and offensive words.

## 3. Setting up and accessing the main features

**No login credentials, sample files, or setup of any kind are required.** The
app opens straight into today's puzzle. There is no account, no sign-in, no
onboarding, and no gated content. A reviewer can exercise 100% of the app from
a cold install with no credentials.

The whole app is three tabs across the top:

- **Play** — today's letters, and a text box. Type a word containing them and
  press submit. A rejected word costs nothing and you may try as many as you
  like; only a word the game accepts spends one of your four guesses. Each
  accepted word gets a rarity score and tier. You may stop early with "Lock in
  my result" or play all four. A "How to play" sheet and a "Word rules" sheet
  are reachable from this screen.
- **Leaderboards** — daily, weekly and monthly top-fifteen boards, by score.
- **Words found** — the words other players found on today's puzzle.

Two further things a reviewer will see on the Play screen:

- **Suggest a word** — a box for telling us a word the curated dictionary is
  missing. What is typed is sent to us privately and is never shown to any
  other player. It is a suggestion queue, not a post.
- **Feedback** — a box for sending a note about the game. Same: private to us,
  never displayed in the app.

Arrows step back to previous days' puzzles. Past puzzles are playable but do
not count toward the boards or the streak.

**On user-generated content:** we want to be explicit, because the app does
show content that originated with other players. It is not free-form content
and there is nothing a player can author:

- The words on the "Words found" feed and the leaderboards are **dictionary
  words only**. A submission is accepted only if it is in the app's curated
  200,000-word list, or — when it is not — only if Merriam-Webster's
  dictionary API attests it as an ordinary, current, inoffensive word. Nothing
  a player types that is not a real English word can ever reach another
  player's screen.
- Player names on the leaderboard are **generated, not chosen**. The name is a
  pure function of a random identifier the install invented for itself
  (`StormyFox47`), drawn from a hand-written word list. There is no display
  name field, the server never stores one, and no player can pick, edit, or
  impersonate a name.

So there is no free-text field whose contents are published, no profiles, no
messaging, no images, and no way for one player to direct anything at another
— which is why the app carries no reporting or blocking mechanism. If App
Review reads the finds feed as user-generated content notwithstanding the
above, we will add the 1.2 mechanisms; please tell us and we will ship them.

## 4. External services, tools and platforms

| Service | What it does for the app |
| --- | --- |
| **Vercel** | Hosts `wordink.app` and the app's API endpoints (leaderboard reads and score writes, live word validation). The only server the app talks to. |
| **Supabase** (Postgres) | The database behind the leaderboard and the finds feed — scores and found words, stored under the install's random identifier. |
| **Merriam-Webster Dictionary API** | Server-side only. Asked whether a word the offline dictionary rejected is nonetheless a real, current, inoffensive English word. The API key never reaches the device. |
| **Datamuse API** | Server-side only. Supplies a frequency for such a word so it can be scored on the same scale as the curated ones. |
| **wordfreq** (open-source dataset) | The published word-frequency data the rarity scores come from. Precomputed offline and shipped inside the app — gameplay makes no live frequency lookup. |
| **Expo / EAS** | Build and submission tooling only. Not a runtime service. |

**No authentication service** — there are no accounts.
**No payment processor** — there are no purchases, subscriptions, or ads.
**No AI or machine-learning service.** Scoring is arithmetic over a fixed
frequency table, not a model.
**No analytics.** The website reports gameplay events to Vercel Analytics; this
build disables reporting before the first render and sends none of it
(`setReporting(false)` in `native/src/host/install.ts`).
**No permissions are requested** — no camera, location, contacts,
notifications, or tracking identifier. No IDFA, no ATT prompt, no third-party
SDKs of any kind.

What leaves the device: the score and words for a puzzle, under a random
per-install identifier; and — only when the player presses the button that
says so — a word suggestion or a feedback note. Nothing is asked of the player
that could identify them, because the app never asks the player for anything.

Privacy policy: https://www.wordink.app/privacy.html
Terms: https://www.wordink.app/terms.html

## 5. Regional differences

**There are none.** The app functions identically in every region and on every
device. Specifically:

- The daily puzzle is chosen deterministically from a fixed list by the date,
  with no server deciding it, so every player worldwide gets the same letters.
- There is no geolocation, no region check, no region-gated content, no
  region-specific pricing (there is no pricing), and no content that varies by
  store front.
- The app is English-only, since the game is about English word frequency. It
  is not localized, and no feature is withheld from any locale.

## 6. Regulated industry / third-party material

The app is not in a regulated industry. It is a word game with no financial,
health, gambling, or similar element.

On third-party material: the rarity scores derive from **wordfreq**, an
open-source word-frequency dataset released under the Apache License 2.0,
which permits this use. The word list itself is our own curated compilation.
Merriam-Webster and Datamuse are used through their published APIs, server
side, under their own terms — Merriam-Webster under its Dictionary API
non-commercial developer terms, within the documented request quota. No
copyrighted dictionary text is reproduced in the app; the app stores whether a
word is playable and a numeric frequency, not definitions.

---

## What you have to record

The recording is the one item nobody can produce from this repo. Apple wants
it captured on a **physical device on the current iOS**, starting from launch
and showing the typical flow. Roughly three minutes:

1. Launch from the home screen — show the icon and the cold start.
2. Play screen: read today's letters. Type a word that does *not* contain them
   and show the rejection costing nothing. Type a real one; show the score and
   tier land.
3. Play out the remaining guesses, or press "Lock in my result".
4. Open the "How to play" and "Word rules" sheets.
5. Open **Leaderboards** — show the daily, weekly and monthly boards, and that
   the names are generated handles.
6. Open **Words found** — show the finds feed.
7. Step back a day with the arrows and show a past puzzle.
8. Show "Suggest a word" and the feedback box, and say in the reply (as above)
   that neither is displayed to other players.
9. Share the result, to show the system share sheet.

Say in the reply that no login, registration, deletion, purchase, or
content-reporting flow is shown because none exists in the app.
