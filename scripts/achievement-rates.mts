/**
 * The share of players holding each achievement, for the line under every
 * badge on the Stats page (see `earnedShareLabel` in src/game/achievements.ts).
 *
 * Achievements live only on each player's device, so this rebuilds every
 * player's record from what the server keeps -- the leaderboard's scores,
 * finds and streaks, plus the analytics events that carry a player id -- and
 * runs the game's own checks over it -- on `countedRecord`, so an unattested
 * Legend counts toward no badge here, the way the game counts it when it
 * reports a player's badges. The base is every player who has ever
 * guessed a word, accepted or not; bots, Muse and the maintainer are left out
 * the way the analytics page leaves them out.
 *
 * Reads production through the logged-in Supabase CLI (read-only queries):
 *
 *   ./node_modules/.bin/vite-node scripts/achievement-rates.mts
 *
 * Writes src/data/achievement-rates.json, the snapshot the page shows until the
 * live counts arrive and the floor under them after (see `ratesNow`). With
 * `--backfill <file>` it also writes the SQL that loads every player's badges
 * into player_achievements, for the players who were playing before the game
 * reported them -- run by hand:
 *
 *   supabase db query --linked --project-ref hjjdnbftdwswkfqnsejt -f <file>
 *
 * Some of the record is approximate:
 *   - before 2026-08-28 the board kept only a day's top word, so the rest of
 *     that day's words are counted as Common;
 *   - turned-away guesses are only known from 2026-09-25, when analytics began
 *     carrying the player id, so a puzzle before then never counts as a Clean
 *     copy;
 *   - most suggestions were logged without a player id, so the two Word
 *     scouting badges undercount.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const { ACHIEVEMENTS, countedRecord } = await import("../src/game/achievements.ts");
const { rarityFor, rarityForZipf, scoringReady } = await import("../src/game/dictionary.ts");
const { maxGuessesFor } = await import("../src/game/constants.ts");
const { dropForDate } = await import("../src/game/drop.ts");
type AchievementRecord = import("../src/game/achievements.ts").AchievementRecord;
type DailyProgress = import("../src/game/types.ts").DailyProgress;
type Rarity = import("../src/game/types.ts").Rarity;
type GameMode = import("../src/game/mode.ts").GameMode;

const PROJECT_REF = "hjjdnbftdwswkfqnsejt";
/** When analytics events began carrying the player id. */
const ANALYTICS_PID_START = "2026-09-25";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const out = resolve(import.meta.dirname, "../src/data/achievement-rates.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function query(sql: string): Row[] {
  const text = execFileSync(
    "supabase",
    ["db", "query", "--linked", "--project-ref", PROJECT_REF, sql],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );
  const [data] = [JSON.parse(firstJson(text))];
  return data.rows ?? data;
}

/** The CLI can follow its JSON with an update notice. */
function firstJson(text: string): string {
  const start = text.indexOf("{");
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error("no JSON in supabase output");
}

const excluded = new Set(
  query(`
    select distinct props->>'player_id' pid from analytics_events
    where props->>'player_id' is not null and (
      props->>'visitor' = 'mos-muse'
      or (name = 'site_visit' and (props->>'webdriver' = 'true' or props->>'bot_ua' = 'true'
        or props->>'server_bot_ua' = 'true'))
      or coalesce(props->>'source', '') ~* '(^|\\.)vercel\\.(com|app)$'
      or coalesce(props->>'last_source', '') ~* '(^|\\.)vercel\\.(com|app)$')
    union select '87d3b6e1-322e-4928-acee-b4a7086c6e86'
    union select player_id from analytics_excluded_players`).map((r) => r.pid)
);
const guessersFromEvents = query(`
  select distinct props->>'player_id' pid from analytics_events
  where props->>'player_id' is not null and name in ('answer_accepted', 'answer_rejected')`).map(
  (r) => r.pid as string
);
const scores = query(
  "select player_id, puzzle_date, mode, words, retried, top_word, top_zipf from leaderboard_scores"
);
const finds = query(
  "select player_id, puzzle_date, mode, word, zipf from leaderboard_finds order by found_at"
);
const streaks = new Map(
  query("select player_id, best_streak, current_streak from leaderboard_player_streaks").map((r) => [
    r.player_id,
    r,
  ])
);
const puzzleEvents = new Map<string, { rej: number; comp: number }>();
for (const r of query(`
  select props->>'player_id' pid, props->>'puzzle_date' d, coalesce(props->>'mode', '') m,
    count(*) filter (where name = 'answer_rejected') rej,
    count(*) filter (where name = 'puzzle_completed') comp
  from analytics_events
  where props->>'player_id' is not null and name in ('answer_rejected', 'puzzle_completed')
  group by 1, 2, 3`)) {
  for (const key of [`${r.pid}|${r.d}|${r.m}`, `${r.pid}|${r.d}|*`]) {
    const prev = puzzleEvents.get(key) ?? { rej: 0, comp: 0 };
    puzzleEvents.set(key, { rej: prev.rej + Number(r.rej), comp: prev.comp + Number(r.comp) });
  }
}
const suggestions = new Map(
  query(`
    select e.props->>'player_id' pid, min(e.created_at)::date::text d,
      bool_or(s.status = 'accepted') accepted
    from analytics_events e left join word_sightings s on s.word = lower(e.props->>'word')
    where e.name = 'word_suggested' and e.props ? 'player_id'
    group by 1`).map((r) => [r.pid, r])
);

const bestWordWins = new Map(
  query(
    `select player_id::text pid, wins from public.leaderboard_best_word_wins(current_date)`
  ).map((r) => [r.pid, Number(r.wins)])
);

await scoringReady("2026-08-10");
await scoringReady();

/** A word scored as the game scores it now, falling back on the Zipf the board kept. */
function scored(word: string, zipf: number, date: string, mode?: GameMode) {
  return (
    rarityFor(word, date, mode) ?? {
      rarity: rarityForZipf(Number(zipf), date, mode),
      zipf: Number(zipf),
    }
  );
}

interface Puzzle {
  date: string;
  mode?: GameMode;
  words: { word: string; rarity: Rarity; zipf: number }[];
  ranked?: Row;
}
const puzzles = new Map<string, Map<string, Puzzle>>();
function puzzle(pid: string, date: string, mode: string | null): Puzzle {
  const mine = puzzles.get(pid) ?? new Map<string, Puzzle>();
  puzzles.set(pid, mine);
  const key = `${date}|${mode ?? ""}`;
  if (!mine.has(key)) mine.set(key, { date, mode: (mode ?? undefined) as GameMode, words: [] });
  return mine.get(key)!;
}
for (const f of finds) {
  const p = puzzle(f.player_id, f.puzzle_date, f.mode);
  p.words.push({ word: f.word, ...scored(f.word, f.zipf, f.puzzle_date, p.mode) });
}
for (const s of scores) {
  const p = puzzle(s.player_id, s.puzzle_date, s.mode);
  p.ranked = s;
  if (p.words.length > 0) continue;
  p.words.push({ word: s.top_word, ...scored(s.top_word, s.top_zipf, s.puzzle_date, p.mode) });
  for (let i = 1; i < s.words; i++) p.words.push({ word: "", rarity: "Common", zipf: 7 });
}

function recordFor(pid: string): AchievementRecord {
  const mine = [...(puzzles.get(pid)?.values() ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const history: DailyProgress[] = mine.map((p) => {
    const ev =
      puzzleEvents.get(`${pid}|${p.date}|${p.mode ?? ""}`) ?? puzzleEvents.get(`${pid}|${p.date}|*`);
    const rejectionsKnown = p.date >= ANALYTICS_PID_START && ev;
    return {
      date: p.date,
      drop: dropForDate(p.date),
      mode: p.mode,
      acceptedWords: p.words,
      rejectedAttempts: rejectionsKnown ? Array<string>(ev.rej).fill("") : [""],
      completed: p.words.length >= maxGuessesFor(p.date) || Boolean(ev?.comp),
      retryUsed: Boolean(p.ranked?.retried),
      firstWordAt: p.date,
    } as DailyProgress;
  });
  const streak = streaks.get(pid);
  const suggestion = suggestions.get(pid);
  return {
    history,
    onItsDay: [...new Set(mine.filter((p) => p.ranked).map((p) => p.date))],
    streak: {
      currentStreak: streak?.current_streak ?? 0,
      longestStreak: streak?.best_streak ?? 0,
      lastCompletedDate: null,
    },
    bestWordWins: bestWordWins.get(pid) ?? 0,
    suggestions: suggestion
      ? [
          {
            word: "",
            suggestedOn: suggestion.d,
            ...(suggestion.accepted ? { acceptedOn: suggestion.d } : {}),
          },
        ]
      : [],
  };
}

const guessers = [...new Set([...puzzles.keys(), ...guessersFromEvents])].filter(
  (pid) => pid && !excluded.has(pid)
);
const today = new Date().toISOString().slice(0, 10);
const earned: Record<string, number> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, 0]));
const rows: string[] = [];
for (const pid of guessers) {
  const record = countedRecord(recordFor(pid));
  for (const a of ACHIEVEMENTS) {
    const { earnedOn } = a.check(record, today);
    if (!earnedOn) continue;
    earned[a.id]++;
    if (UUID_RE.test(pid)) rows.push(`('${pid}', '${a.id}', '${earnedOn}')`);
  }
}

const backfill = process.argv.indexOf("--backfill");
if (backfill >= 0) {
  writeFileSync(
    process.argv[backfill + 1],
    "insert into public.player_achievements (player_id, achievement_id, earned_on) values\n" +
      rows.join(",\n") +
      "\non conflict do nothing;\n"
  );
  console.log(`${rows.length} badges -> ${process.argv[backfill + 1]}`);
}

writeFileSync(
  out,
  JSON.stringify({ asOf: today, players: guessers.length, earned }, null, 2) + "\n"
);
console.log(`${guessers.length} players who have guessed, as of ${today}`);
for (const a of ACHIEVEMENTS) {
  console.log(`${a.title.padEnd(22)} ${((100 * earned[a.id]) / guessers.length).toFixed(1)}%`);
}
