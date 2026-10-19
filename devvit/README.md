# WordInk

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

There are two ways to play. **Standard** scores a word as its common form, so
`plays` is worth what `play` is worth; **Freeform** scores every word on its
own frequency and lets obsolete and archaic words count. Each has its own
board.

Archive puzzles are playable from the same post. They do not count towards the
board or the streak, for the obvious reason that the answers are lookupable.

## Adding it to your subreddit

Install it and a post goes up straight away. After that, a new one goes up
every day at 10:05 UTC, titled with the date. There is nothing to configure.

Your subreddit gets a board of its own: your members' scores, alongside the
players of the same game at [wordink.app](https://www.wordink.app/). Two items
are added to the subreddit's moderator menu:

- **Post today's puzzle** — puts up today's post if the schedule ever misses
  one.
- **Refresh website scores** — pulls the website's players in now rather than
  on the next quarter-hour.

The game has no chat of its own; the post's comments are where your members
talk about the day's letters.

## What it stores, and where

- **On Reddit, under the player's username:** their score for each puzzle, their
  rarest word of that day, and which words they found. This is what the
  leaderboard and the finds feed are built from. It lives in the app's own
  storage on Reddit and goes nowhere else.
- **In the player's browser:** the puzzle in progress and their streak.
- **Nothing is reported to any analytics service.** The website this game also
  runs on uses analytics; they are switched off here, because sending what
  Reddit's players do to a third party is not something this app should do.

There is a privacy policy at https://www.wordink.app/privacy.html and terms at
https://www.wordink.app/terms.html.

## Why it asks for what it asks for

- **Outbound HTTP, to one host.** The same game runs at
  [wordink.app](https://www.wordink.app/), and this app reads three things from
  that site's database: the public leaderboard totals, so both sets of players
  can appear on one board; the dictionary verdicts the website has already
  collected, so this app never has to call a dictionary service itself; and the
  scoring corrections made there, so a word is worth the same in both places.
  All three are reads. **No Reddit username, and nothing about any Reddit
  player, is ever sent off Reddit.** The only host it contacts is the game's own
  database, declared in `devvit.json`.
- **Creating posts, and acting as a moderator.** A scheduled job puts up one
  post a day, which is how the game is played at all. A moderator menu item
  creates one by hand if the schedule is missed.
- **The scheduler.** Two jobs: the daily post, and a periodic refresh of the
  website's scores.

For how the app is built, see [DEVELOPING.md](DEVELOPING.md).
