/**
 * The leaderboard, on Redis instead of Postgres.
 *
 * The website's board is four SQL functions over one table: rows go in, and
 * every board is a GROUP BY over a date window at read time (see
 * supabase/migrations/20260825000000_leaderboard.sql). Redis has no GROUP BY, so
 * the aggregation moves to write time -- each submission updates the day's row
 * and then pushes the difference it made into the week's and the month's sorted
 * sets. Reads become a range query and a hydrate.
 *
 * That trade is the one thing to understand before changing anything here. The
 * SQL version can never disagree with itself, because every board is derived
 * from the rows on every read. This version keeps four things in step by hand,
 * so every write path has to update all of them or the boards drift apart.
 * `submitScores` is the only writer, for exactly that reason.
 *
 * What is faithful to the original:
 *   - a day's score is monotonic, so repeats and out-of-order arrivals are
 *     harmless, and a day only ever goes up -- except across a retry, which is
 *     the one way a day can get smaller (see `retried`);
 *   - a player's word for a window is the rarest they found inside it, picked
 *     by smallest Zipf, which needs no dictionary on this side;
 *   - boards rank on summed total, which rewards playing every day over peaking
 *     once, and ties break on the rarest word then on who got there first;
 *   - the finds feed is one puzzle's own finds, live, which is a deliberate
 *     call the website already made: this is a daily game where everybody gets
 *     the same drop, so the feed is much better live than a day behind, and
 *     handing a mid-play reader some answers is the price.
 *
 * What is not, and knowingly: a below-the-cut self rank comes from `zRank` on
 * the score alone, so two players on identical totals can be handed the same
 * rank rather than separated by their rarest word. The SQL ranks the whole
 * window to answer that. Doing the same here would mean reading every member of
 * the set on every request, which is the cost the write-time aggregation was
 * chosen to avoid. The boards themselves -- the fifteen rows anybody actually
 * reads -- are fully tie-broken, because those rows are hydrated anyway.
 */

import { redis } from '@devvit/web/server';
import {
  BOARD_LIMIT,
  MAX_LIMIT,
  WORDS_LIMIT,
  type BoardRow,
  type FoundRow,
  type ScoreSubmission,
} from '../../shared/leaderboard';
import { monthStartOf, weekStartOf } from '../../shared/windows';
import { importedBoard, importedFinds } from './import';

/** Which window a board counts. The key prefix is the whole difference. */
type Window = 'd' | 'w' | 'm';

/** One player's stored account of one puzzle. */
interface DayRow {
  word: string;
  zipf: number;
  total: number;
  top: number;
  words: number;
  at: number;
}

const boardKey = (window: Window, start: string) => `board:${window}:${start}`;
/** The rarest word each player found inside one window: field = username. */
const bestKey = (window: Window, start: string) => `best:${window}:${start}`;
/** How many puzzles each player scored on inside one window: field = username. */
const puzzlesKey = (window: Window, start: string) => `puzzles:${window}:${start}`;
const dayKey = (date: string, user: string) => `day:${date}:${user}`;
/** When a player first scored anything, which is the boards' last tie-break. */
const JOINED_KEY = 'joined';
/** One puzzle's distinct words, scored by when each was last seen. */
const findsKey = (date: string) => `finds:${date}`;
const findKey = (date: string, word: string) => `find:${date}:${word}`;
/** Who has found one word on one puzzle, as a hash so its length is the count. */
const findersKey = (date: string, word: string) => `finders:${date}:${word}`;

/**
 * Record a batch of a player's scores.
 *
 * The only writer. Every board, every window word, every puzzle count and the
 * finds feed are updated from here, because anything that writes one of them
 * without the others leaves the boards disagreeing.
 *
 * Returns how many days it actually changed, which is what the endpoint reports
 * back -- a re-sent backfill changes nothing and says so.
 */
export async function submitScores(
  user: string,
  scores: readonly ScoreSubmission[]
): Promise<number> {
  // One entry per date before anything is written. A batch can name the same day
  // twice, and the second write would otherwise be resolved against a row the
  // first has already moved. Ranked rather than merged per field, so the day's
  // word and its numbers always come from the same entry.
  const byDate = new Map<string, ScoreSubmission>();
  for (const score of scores) {
    const held = byDate.get(score.date);
    if (!held || score.total > held.total || (score.total === held.total && score.zipf < held.zipf)) {
      byDate.set(score.date, score);
    }
  }

  let written = 0;
  for (const score of byDate.values()) {
    if (await writeDay(user, score)) written += 1;
  }
  if (written > 0) await redis.hSetNX(JOINED_KEY, user, String(Date.now()));
  return written;
}

/** One day's write, and the four aggregates it has to carry with it. */
async function writeDay(user: string, score: ScoreSubmission): Promise<boolean> {
  const previous = await readDay(score.date, user);

  // Monotonic, except across a retry. A day's score only ever goes up, so a
  // late-arriving early submission cannot undo a better one and a re-sent
  // backfill is a no-op. A retry is the one thing that says "this account of the
  // day replaces the last one" rather than "this is another look at it", and it
  // is the only way a day can get smaller.
  const total = score.retried ? score.total : Math.max(previous?.total ?? 0, score.total);
  const raising = !previous || total > previous.total || Boolean(score.retried);
  if (previous && !raising) {
    // Nothing about the day moved. The finds still might -- a player can turn up
    // a word that does not beat their best -- so the feed is updated either way.
    await recordFinds(user, score);
    return false;
  }

  // The word follows the score it came with, so the word on the row is always
  // the word that earned the number on the row.
  const row: DayRow = {
    word: score.word,
    zipf: score.zipf,
    total,
    top: score.retried ? score.top : Math.max(previous?.top ?? 0, score.top),
    words: score.retried ? score.words : Math.max(previous?.words ?? 0, score.words),
    at: previous?.at ?? Date.now(),
  };
  await redis.hSet(dayKey(score.date, user), {
    word: row.word,
    zipf: String(row.zipf),
    total: String(row.total),
    top: String(row.top),
    words: String(row.words),
    at: String(row.at),
  });

  // What this write changed, which is what the wider windows have to move by.
  // The daily board is the day itself, so it is set rather than incremented.
  const delta = total - (previous?.total ?? 0);
  const week = weekStartOf(score.date);
  const month = monthStartOf(score.date);
  await redis.zAdd(boardKey('d', score.date), { member: user, score: total });
  if (delta !== 0) {
    await redis.zIncrBy(boardKey('w', week), user, delta);
    await redis.zIncrBy(boardKey('m', month), user, delta);
  }

  // A day the player had not scored before is a new puzzle in both windows.
  if (!previous) {
    await redis.hSet(puzzlesKey('d', score.date), { [user]: '1' });
    await redis.hIncrBy(puzzlesKey('w', week), user, 1);
    await redis.hIncrBy(puzzlesKey('m', month), user, 1);
  }

  await Promise.all([
    rememberBest('d', score.date, user, score),
    rememberBest('w', week, user, score),
    rememberBest('m', month, user, score),
  ]);
  await recordFinds(user, score);
  return true;
}

/**
 * Keep the rarest word a player has found inside one window.
 *
 * Rarest by smallest Zipf, which is what lets this side pick a word with no
 * dictionary of its own: every scoring system this game has used maps Zipf to
 * score monotonically downward, so the smallest Zipf is the rarest word under
 * any of them. Turning it back into a score is the client's job, with today's
 * dictionary -- which is how a word rescored since it was found reads at what it
 * is worth now.
 */
async function rememberBest(
  window: Window,
  start: string,
  user: string,
  score: ScoreSubmission
): Promise<void> {
  const key = bestKey(window, start);
  const held = await redis.hGet(key, user);
  if (held) {
    const [, zipf] = splitBest(held);
    if (zipf <= score.zipf) return;
  }
  await redis.hSet(key, { [user]: `${score.word}|${score.zipf}` });
}

/**
 * Add a puzzle's words to its finds feed.
 *
 * Every word the player has accepted, not just their best -- the feed is the
 * interesting half of a day's play, and a player's rarest word is already on
 * the boards. Finders are counted as a hash keyed by username so the same
 * player submitting the same word all day counts once, which is what
 * `count(distinct player_id)` does on the other side.
 */
async function recordFinds(user: string, score: ScoreSubmission): Promise<void> {
  // Sent only for the puzzle being played. A backfilled day carries no list,
  // because the feed shows one drop at a time and past words would be rows
  // nobody can ever see.
  const found = score.found ?? [];
  for (const find of found) {
    await redis.hSet(findersKey(score.date, find.word), { [user]: '1' });
    const finders = await redis.hLen(findersKey(score.date, find.word));
    await redis.hSet(findKey(score.date, find.word), {
      zipf: String(find.zipf),
      finders: String(finders),
    });
    // Scored by when the word was last seen, so the feed reads newest first --
    // something that changes while you watch, rather than a second leaderboard
    // with the same rare words pinned to the top every day.
    await redis.zAdd(findsKey(score.date), { member: find.word, score: Date.now() });
  }
}

/**
 * One board: the top rows of a window, fully ranked.
 *
 * Read as a range over the window's sorted set and then hydrated, which is the
 * shape that keeps this cheap: the set knows the order by score, and only the
 * rows actually being shown pay for their window word and puzzle count. Ties are
 * broken here rather than in Redis -- on the rarest word, then on who got there
 * first, exactly as the SQL does -- because by this point the rows are in hand.
 */
export async function readBoard(
  window: Window,
  start: string,
  limit: number = BOARD_LIMIT
): Promise<BoardRow[]> {
  const bounded = Math.min(Math.max(limit, 1), MAX_LIMIT);
  // Over-read so a tie straddling the cut is broken on the same footing as one
  // inside it: without this, the fifteenth and sixteenth rows on equal totals
  // would be separated by Redis's member ordering rather than by their words.
  const raw = await redis.zRange(boardKey(window, start), 0, bounded * 2 - 1, {
    reverse: true,
    by: 'rank',
  });
  const users = raw.map((entry) => entry.member);
  // Asking for nothing is not a question Redis will take: HMGET with no fields
  // is an error, not an empty answer. Nobody having scored yet is the ordinary
  // state of a board on its first day -- and of every daily board before its
  // first player -- so it reaches this line far more often than it looks.
  const [bests, puzzles, joined] =
    users.length === 0
      ? [[], [], []]
      : await Promise.all([
          redis.hMGet(bestKey(window, start), users),
          redis.hMGet(puzzlesKey(window, start), users),
          redis.hMGet(JOINED_KEY, users),
        ]);

  const mine = raw.map((entry, index) => {
    const [word, zipf] = splitBest(bests[index] ?? '');
    return {
      user: entry.member,
      total: round1(entry.score),
      word,
      zipf,
      puzzles: Number(puzzles[index] ?? 0),
      joined: Number(joined[index] ?? 0),
      source: 'r' as const,
    };
  });

  // The website's players for the same window, imported on a schedule (see
  // core/import.ts). They rank on exactly the same terms as Reddit's own: both
  // games score with the same dictionary, so the totals are comparable, and a
  // board that sorted its two halves differently would not be one board.
  //
  // They carry no arrival time -- the import publishes an aggregate, not a
  // history -- so the last tie-break falls through to the id, which is stable.
  // Only a tie on total *and* on rarest word ever reaches it.
  const theirs = (await importedBoard(window, start)).map((row) => ({
    user: row.playerId,
    total: round1(row.score),
    word: row.windowWord,
    zipf: row.windowZipf,
    puzzles: row.puzzles,
    joined: Number.MAX_SAFE_INTEGER,
    source: 'w' as const,
  }));

  const rows = [...mine, ...theirs];
  rows.sort(
    (a, b) => b.total - a.total || a.zipf - b.zipf || a.joined - b.joined || a.user.localeCompare(b.user)
  );

  return rows.slice(0, bounded).map((row, index) => ({
    rank: index + 1,
    playerId: row.user,
    windowWord: row.word,
    windowZipf: row.zipf,
    score: row.total,
    puzzles: row.puzzles,
    source: row.source,
  }));
}

/**
 * One player's own row, for when they rank below the board's last row.
 *
 * Null when they are already on the board, or have nothing in the window -- in
 * both cases there is nothing here the board is not already saying.
 *
 * The rank is the approximation this file's header names: it counts how many
 * players hold a strictly higher total, so players level on total share a rank
 * rather than being separated by their rarest word. It is honest about the
 * only thing it is used for -- how far below the cut somebody is -- and it costs
 * one command instead of a full scan of the window.
 */
export async function readSelf(
  window: Window,
  start: string,
  user: string,
  board: readonly BoardRow[]
): Promise<BoardRow | null> {
  if (board.some((row) => row.source === 'r' && row.playerId === user)) return null;
  const key = boardKey(window, start);
  const total = await redis.zScore(key, user);
  if (total === undefined || total === null) return null;

  const [rank, best, puzzles] = await Promise.all([
    // zRank counts from the bottom, so the number of Reddit players above is
    // everything in the set minus this player's position minus themselves.
    //
    // The sorted set holds only Reddit's own players, and the board this rank
    // is read against holds both populations -- so the website's players above
    // this score have to be counted too, or a player sitting sixteenth on the
    // merged board is told they are first.
    Promise.all([
      redis.zCard(key),
      redis.zRank(key, user),
      importedBoard(window, start),
    ]).then(
      ([size, below, imported]) =>
        size - (below ?? 0) + imported.filter((row) => row.score > total).length
    ),
    redis.hGet(bestKey(window, start), user),
    redis.hGet(puzzlesKey(window, start), user),
  ]);
  const [word, zipf] = splitBest(best ?? '');

  return {
    rank,
    playerId: user,
    windowWord: word,
    windowZipf: zipf,
    score: round1(total),
    puzzles: Number(puzzles ?? 0),
    source: 'r',
  };
}

/**
 * The words players found on one puzzle, newest first.
 *
 * One drop's own finds, live -- not the day before's. A find belongs to a
 * *drop*, not to a moment in UTC: the page heads the list with the day's drop,
 * so the rows under it have to be that day's finds or the heading is wrong.
 * `asphyxiate` means nothing until you know the day asked for PHY.
 *
 * The date is therefore used as the caller gave it, with no `max(client, utc)`
 * bound over the top. The website tried that and it was reasoning about
 * timezones rather than about puzzles: an American evening is already tomorrow
 * in UTC, so the feed queried a day nobody in the Americas had reached and
 * "Today's finds" went empty through the busiest hours of the day.
 */
export async function readFinds(date: string, limit = WORDS_LIMIT): Promise<FoundRow[]> {
  const entries = await redis.zRange(findsKey(date), 0, Math.min(limit, WORDS_LIMIT) - 1, {
    reverse: true,
    by: 'rank',
  });

  const rows = await Promise.all(
    entries.map(async (entry) => {
      const stored = await redis.hGetAll(findKey(date, entry.member));
      return {
        word: entry.member,
        zipf: Number(stored?.zipf ?? 0),
        finders: Number(stored?.finders ?? 1),
        foundOn: date,
      };
    })
  );

  // The website's finders for the same puzzle, folded in by word. A word both
  // populations turned up is one row carrying both counts -- the feed answers
  // "how many people found this", and splitting it by which game they were
  // playing would answer a question nobody asked.
  //
  // Reddit's own rows lead, because they are the live half and the order here is
  // newest-first; imported words the live half has not seen are appended.
  const merged = new Map(rows.map((row) => [row.word, { ...row }]));
  for (const find of await importedFinds(date)) {
    const held = merged.get(find.word);
    if (held) held.finders += find.finders;
    else merged.set(find.word, { ...find, foundOn: date });
  }
  return [...merged.values()];
}

async function readDay(date: string, user: string): Promise<DayRow | null> {
  const stored = await redis.hGetAll(dayKey(date, user));
  if (!stored || !stored.word) return null;
  return {
    word: stored.word,
    zipf: Number(stored.zipf),
    total: Number(stored.total),
    top: Number(stored.top),
    words: Number(stored.words),
    at: Number(stored.at),
  };
}

/** A stored `word|zipf` pair, or a blank row for a window with nothing in it. */
function splitBest(stored: string): [string, number] {
  const cut = stored.lastIndexOf('|');
  if (cut < 0) return ['', 0];
  return [stored.slice(0, cut), Number(stored.slice(cut + 1))];
}

/** Totals are summed floats; the board shows one decimal, so store one. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
