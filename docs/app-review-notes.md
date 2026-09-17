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

**No credentials, sample files, or setup are required.** There is no account,
no sign-in, no onboarding, and no gated content — the app opens straight into
today's puzzle, and a reviewer can exercise all of it from a cold install.

Three tabs: **Play** (today's letters and a text box — a rejected word costs
nothing, an accepted one spends one of four guesses and gets a rarity score;
"How to play" and "Word rules" sheets are here), **Leaderboards** (daily,
weekly and monthly), and **Words found** (the words other players found
today). Arrows step back to past puzzles, which are playable but do not count
toward the boards or the streak. Also on the Play screen are "Suggest a word"
and a feedback box; both send privately to us and are never shown to another
player.

**On user-generated content**, since the app does display words other players
found: accepted words are dictionary words only — the app's curated list, or
Merriam-Webster attesting an ordinary, current, inoffensive sense — so nothing
a player types that is not a real English word can reach another player's
screen. Leaderboard names are generated from a random per-install identifier
(`StormyFox47`), not chosen: there is no display-name field anywhere, so
nothing can be authored or impersonated. With no profiles, messaging or
images, there is nothing for one player to direct at another, which is why the
app carries no reporting or blocking mechanism. If App Review reads the finds
feed as user-generated content regardless, tell us and we will add the 1.2
mechanisms.

## 4. External services

| Service | What it does |
| --- | --- |
| **Vercel** | Runs the app's backend: the endpoints it calls for leaderboard reads, score writes and live word validation. The only server the app talks to. They are the website's own endpoints, shared so that there is one leaderboard across every version of the game. |
| **Supabase** (Postgres) | The database behind the leaderboard and the finds feed. |
| **Merriam-Webster Dictionary API** | Server-side only: is a word the offline dictionary rejected nonetheless real, current and inoffensive? The key never reaches the device. |
| **Datamuse API** | Server-side only: a frequency for such a word, so it scores on the same scale as the curated ones. |
| **wordfreq** (open-source dataset) | The published frequency data the scores come from, precomputed offline and shipped in the app. No live lookup during play. |
| **Expo / EAS** | Build and submission tooling. Not a runtime service. |

No authentication service (no accounts), no payment processor (no purchases,
subscriptions or ads), and no AI or machine-learning service — scoring is
arithmetic over a fixed table. No analytics: the website reports gameplay
events, and this build disables reporting before the first render and sends
none of it. No permissions, no IDFA, no ATT prompt, no third-party SDKs.

What leaves the device is the score and words for a puzzle, under a random
per-install identifier — plus a word suggestion or feedback note, when the
player presses the button that says so. The app never asks the player for
anything that could identify them.

Privacy policy: https://www.wordink.app/privacy.html
Terms: https://www.wordink.app/terms.html

## 5. Regional differences

None — the app functions identically in every region. The daily puzzle is
picked from a fixed list by the date with no server deciding it, so every
player worldwide gets the same letters; there is no geolocation, no
region-gated content, and no pricing to vary. It is English-only and not
localized, since the game is about English word frequency.

## 6. Regulated industry / third-party material

Neither applies. It is a word game with no financial, health or gambling
element. The frequency data is **wordfreq**, an open-source dataset under the
Apache License 2.0; the word list is our own compilation; Merriam-Webster and
Datamuse are used server-side through their published APIs under their own
terms. No dictionary text is reproduced — the app stores whether a word is
playable and a number, not definitions.

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
