# App Store listing

Everything App Store Connect asks for, written out so it is reviewed here rather
than typed into a web form and forgotten. Character limits are Apple's and are
noted against each field; the counts in brackets are what the text below
actually uses.

Google Play wants most of the same things at different lengths. When that
listing gets written it belongs beside this file, not merged into it — the two
stores disagree about enough that one document serving both would be wrong in
both.

---

## Name — 30 characters max

```
WordInk: Daily Rare Word Game
```

(29) The bare wordmark would be the nicer name and is the one on the icon, but
"WordInk" alone tells a person scrolling search results nothing, and the name is
the only field that is always visible. What follows the colon is doing the work
that the subtitle cannot be relied on to do, since Apple truncates it in several
places the name survives.

## Subtitle — 30 characters max

```
Find the rarest word you can
```

(28) Says the goal rather than the genre. "Daily word puzzle" describes a
shelf with a hundred apps on it; this sentence is the one thing that makes this
game not Wordle, and it is short enough to survive truncation.

## Promotional text — 170 characters max, editable without review

```
Today's letters are up. Four guesses, and the rarest word wins — not the longest. Everyone plays the same drop, so the only question is who thought of the better word.
```

(167) Editable without a new build, which is what it is for: a seasonal line, a
milestone, a nudge on a day with a good drop. The version above is the neutral
one to open with.

## Description — 4000 characters max

```
Every day, everyone gets the same two or three letters. Say INK.

Your job is to find the rarest English word that contains them, in order: thINK, wrINKle, INKling. You get four guesses.

Rarer scores higher. That is the whole game, and it is what makes it a different game from the one you are thinking of. Longer is not better. Harder is not better. "Think" is a perfectly good word and it will score you almost nothing, because everybody thought of it.

HOW IT WORKS

Wrong guesses are free. Type as many as you like — only a word the game accepts spends one of your four, so there is no penalty for trying something you are not sure about.

Every accepted word comes back with a score out of ten and a tier, from Common up through Uncommon, Rare, Extremely Rare, Elusive, Mythic, and Legend. The score is not our opinion. It is measured against published word-frequency data — how often a word actually appears across books, news, film, websites, and conversation. A word you have never heard of is not automatically rare, and a word you use every day cannot be made rare by being long.

There is no timer. There is no streak you lose by thinking for a minute. Take as long as you like; the puzzle is waiting when you come back.

WHAT YOU GET

• One new puzzle a day, the same one for everybody
• Four guesses, and a single retry if you want a word back
• A leaderboard for today, this week, and this month
• A feed of every word anybody found, so you can see what you missed
• A streak, and counters for the days you found something genuinely rare
• Every past puzzle, playable any time, just for fun

NO ACCOUNT

There is nothing to sign up for and nothing to log in to. No email, no password, no social account. The name you appear under on the leaderboard is invented by the app and belongs to your device.

There are no ads, no purchases, no subscription, no energy meter, and no notifications asking you to come back.

WHERE THE WORDS COME FROM

The word list is curated from SCOWL and Wiktionary and runs past 200,000 entries. Proper nouns, abbreviations, misspellings, and obsolete or archaic words are not playable, so the game stays the same game for everyone. If you find something good that is missing, there is a box to suggest it, and it goes in a queue a human reads.

The scoring gets careful about the things word games usually get wrong. Adding an s to a word is not a discovery, so a plural is scored as the word it came from rather than as a rare word in its own right. This is why "asphyxiates" does not outrank "asphyxiate".

WordInk is also playable in a browser at wordink.app and inside Reddit. It is the same daily puzzle and the same leaderboard wherever you play it.

Made by one person, for fun.
```

(2,733) Written to be read in the first three lines, which is all most people
see before the More button. The rarity rule is stated immediately and then
stated again as a negative — longer is not better — because that is the single
thing a new player gets wrong and the one that decides whether they understand
their first score.

The scoring-fold paragraph is in there deliberately, and is the one part that
risks being too much detail for a store page. It stays because it is the
strongest available evidence that the scoring is thought through rather than a
random number, and because that is the objection a skeptical reader arrives
with.

## Keywords — 100 characters, comma-separated, no spaces

```
word,puzzle,daily,vocabulary,rare,letters,anagram,spelling,brain,wordle,scrabble,lexicon,trivia
```

(95) No spaces after the commas — Apple counts them. Terms already in the name
and subtitle are not repeated here, because Apple indexes those fields too and a
duplicate spends characters twice. "wordle" and "scrabble" are competitor terms,
which Apple permits as keywords; they are not used in any visible text.

## URLs

| Field | Value |
| --- | --- |
| Support URL | `https://www.wordink.app/` |
| Marketing URL | `https://www.wordink.app/` |
| Privacy Policy URL | `https://www.wordink.app/privacy.html` |

Apple requires a support URL that a person can actually get help from. The site
is the honest answer today; if it ever needs a dedicated contact route, the
feedback box inside the app is the route that exists.

## Category

- **Primary:** Games → Word
- **Secondary:** Games → Puzzle

## Age rating

Expect **4+**. The questionnaire answers are all "None" or "No". The one that
needs thought is user-generated content: the app displays other players' found
words, but every one of them comes from the curated dictionary, so a player
cannot put arbitrary text on another player's screen. Answer that question as
no.

## App privacy — the nutrition label

The short version: **data is collected and linked to a random identifier this
install invented for itself; none of it is used for tracking.**

| Question | Answer |
| --- | --- |
| Does the app collect data? | Yes |
| Data types | **Identifiers** → User ID (the app's own random UUID). **Usage Data** → Product Interaction (scores and words played). |
| Purpose | App Functionality only |
| Linked to the user? | Yes — linked to that random identifier |
| Used for tracking? | **No** |

Nothing here is an account, an email, a name, a device identifier, or an
advertising identifier. The UUID is generated on the device, never leaves it
except attached to a score, and identifies a leaderboard row rather than a
person. It is declared as linked because a leaderboard is by definition a list
of scores against a persistent identity — saying otherwise would be a more
flattering answer than a true one.

Not collected, and worth stating because reviewers check: no contacts, no
location, no photos, no health data, no purchase history, no browsing history,
no advertising data, no crash or performance analytics. This build sends nothing
to Vercel Analytics or to the game's own event table — see
`native/src/host/install.ts`.

Word suggestions and feedback are sent only when the player types them into a
box and presses the button that says it will send them. Those are covered by
"Product Interaction" above.

## Notes for the reviewer

```
No account, no login, and no purchases — everything in the app is reachable
immediately.

The puzzle is chosen by the device's calendar date, so opening the app on any
day shows that day's letters. If you want to see a finished puzzle without
playing one, the arrows under the tabs step back to previous days, which are
fully playable.

The leaderboard and the "Words found" feed read from https://www.wordink.app,
which is the same game running as a website. That is the only host the app
contacts.
```

## Screenshots

Apple requires 6.9" iPhone shots, and iPad shots if the app is offered on iPad
(`supportsTablet` is on, so it is). Up to 10 per size, first three matter most.

In order:

1. **The puzzle mid-play** — letters up, three words in the guess log, one of
   them crowned with a purple Extremely Rare badge. This is the only screenshot
   that has to work, because it shows the scoring tiers, which is the game.
2. **The leaderboard**, on Today, with a row highlighted as the player's.
3. **The finds feed**, showing the spread of tiers across a day.
4. **The results panel**, with the share preview visible.
5. **The rules sheet**, for the reader who wants to know what a score means.

Take them from a real run rather than mocking them up — Apple rejects
screenshots that show a UI the app does not have.

## What's New

First release, so this field is not used. For subsequent releases, say what
changed for a player rather than what changed in the code; scoring changes
especially, since a player who finds their word scored differently deserves to
read why.
