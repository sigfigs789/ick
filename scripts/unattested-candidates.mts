/**
 * List the words a puzzle can accept that no frequency corpus measures -- the
 * ones that score the unattested sentinel (a flat 10.00 Legend before any fold)
 * -- so the "Estimate unattested Zipf" workflow can hand them to Claude for a
 * guessed frequency. See src/data/estimated-zipf/.
 *
 * Run with vite-node so the answer comes from the game's own code rather than a
 * mirror of it: every word in the curated list and the corpus that contains the
 * drop goes through `evaluateSubmission` in both modes, and a word is a
 * candidate when either mode accepts it on a sentinel Zipf of its own.
 *
 *   ./node_modules/.bin/vite-node scripts/unattested-candidates.mts -- --date 2026-10-08
 *   ./node_modules/.bin/vite-node scripts/unattested-candidates.mts -- --date 2026-10-08 --out .tmp/candidates.json
 *
 * A sweep widens it two ways. `--days N` covers the drops of the N puzzles from
 * `--date` on, each word checked on the puzzle whose drop it contains.
 * `--words file` adds a list of words (one per line, a tab and anything after
 * it ignored) -- the ones players have already played at the sentinel, from
 * scripts/played-unattested-words.sh -- each checked on `--date` against a drop
 * it contains, and marked `played`. Every estimate still applies from `--date`.
 *
 * Words that already carry an estimate live for this date are left out, so a
 * re-run only reports what is still unscored. Also writes `anchors`: measured
 * words containing the same drop across the deep tail, with their real Zipf,
 * for Claude to calibrate its guesses against.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { CORPUS_SOURCES } from "../src/game/corpus.ts";

const root = resolve(import.meta.dirname, "..");

// The corpus loads over fetch in the browser; serve public/ off disk instead.
globalThis.fetch = (async (input: string | URL) => {
  const path = String(input).split("?")[0].replace(/^\//, "");
  const body = readFileSync(resolve(root, "public", path));
  return new Response(body);
}) as typeof fetch;

const { loadCorpus, corpusEntry, LEXICON_SOURCES } = await import("../src/game/corpus.ts");
const { evaluateSubmission } = await import("../src/game/submit.ts");
const { asMode } = await import("../src/game/mode.ts");
const { dropForDate } = await import("../src/game/drop.ts");
const { addDays } = await import("../src/game/date.ts");
const { unattestedZipf, estimatedZipfEntry } = await import("../src/game/dictionary.ts");
const dictionary = (await import("../src/data/dictionary.json")).default as string[];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const date = arg("date");
const days = Number(arg("days") ?? 1);
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(days) || days < 1) {
  console.error(
    "usage: unattested-candidates.mts --date YYYY-MM-DD [--days N] [--words file] [--drop XY] [--out file.json]"
  );
  process.exit(2);
}
// The puzzles the sweep covers, each with its drop. `--drop` overrides the
// first, for checking a drop by hand.
const puzzles = Array.from({ length: days }, (_, i) => {
  const day = addDays(date, i);
  return { date: day, drop: (i === 0 && arg("drop") ? arg("drop")! : dropForDate(day)).toLowerCase() };
});
const wordsFile = arg("words");
const played = wordsFile
  ? readFileSync(wordsFile, "utf8")
      .split("\n")
      .map((line) => line.split("\t")[0].trim().toLowerCase())
      .filter((word) => /^[a-z]+$/.test(word))
  : [];

if (!(await loadCorpus())) {
  console.error("could not load public/corpus");
  process.exit(1);
}

// Every corpus word, decoded the same way corpus.ts does (front-coded lines).
function corpusWords(): string[] {
  const lines = readFileSync(resolve(root, "public/corpus/words.txt"), "utf8").split("\n");
  const out: string[] = [];
  let previous = "";
  for (const line of lines) {
    if (!line) continue;
    const word = previous.slice(0, line.charCodeAt(0) - 48) + line.slice(1);
    out.push(word);
    previous = word;
  }
  return out;
}

const sentinel = unattestedZipf();
const seen = new Set<string>();
const checked = new Set<string>();
const candidates: {
  word: string;
  /** The drop and puzzle it was checked on, which estimated-scores.mts reuses. */
  drop: string;
  date: string;
  /** Which modes accept it on a sentinel Zipf of its own. */
  modes: ("standard" | "freeform")[];
  /** The score Standard shows after the fold, when the fold moves it. */
  standardZipf: number | null;
  /** Lexicons that vouch for it, for Claude's context. */
  sources: string[];
  /** In the --words list: players have already played it at the sentinel. */
  played: boolean;
}[] = [];

function consider(word: string, drop: string, day: string, isPlayed: boolean): void {
  if (checked.has(word)) return;
  checked.add(word);
  const estimate = estimatedZipfEntry(word);
  if (estimate && estimate.since <= date!) return;

  const modes: ("standard" | "freeform")[] = [];
  let standardZipf: number | null = null;
  for (const mode of ["standard", "freeform"] as const) {
    const result = asMode(mode, () => evaluateSubmission(word, drop, [], day));
    if (!result.ok || !result.word) continue;
    // Freeform does not fold, so its Zipf is the word's own. Standard can only
    // raise it; a fold that lands on a measured base is reported, not hidden.
    if (mode === "freeform" && result.word.zipf !== sentinel) continue;
    modes.push(mode);
    if (mode === "standard") standardZipf = result.word.zipf === sentinel ? null : result.word.zipf;
  }
  // Standard alone accepting the word on a folded score still means its own
  // Zipf is unmeasured -- check the word itself, not the fold.
  if (modes.length === 1 && modes[0] === "standard") {
    const own = corpusEntry(word)?.zipf;
    if (own != null) return;
  }
  if (modes.length === 0) return;

  const entry = corpusEntry(word);
  const sources = entry
    ? CORPUS_SOURCES.filter((_, bit) => entry.sources & (1 << bit))
    : ["dictionary"];
  candidates.push({ word, drop: drop.toUpperCase(), date: day, modes, standardZipf, sources, played: isPlayed });
}

// Played words first, so a word both played and in a coming drop is marked
// played. Any two letters of the word serve as its drop: its own Zipf, which is
// what an estimate stands in for, does not depend on the drop.
for (const word of played) {
  if (word.length > 2) consider(word, word.slice(0, 2), date, true);
}
const lexicon = [...new Set([...dictionary, ...corpusWords()])];
for (const puzzle of puzzles) {
  for (const word of lexicon) {
    if (!word.includes(puzzle.drop)) continue;
    seen.add(word);
    consider(word, puzzle.drop, puzzle.date, false);
  }
}

// Calibration: measured words with the same drop, a few per Zipf band from the
// deepest measured tail up to the uncommon. Every k-th word of each band, so the
// pick is deterministic and spread across the alphabet.
const BANDS = [-2, -1, 0, 1, 2, 3, 4];
const PER_BAND = 5;
const byBand: { word: string; zipf: number }[][] = BANDS.slice(1).map(() => []);
for (const word of seen) {
  // Untagged lexicon words only, so the calibration is real vocabulary rather
  // than crawl residue or a proper noun.
  const entry = corpusEntry(word);
  const zipf = entry?.zipf;
  if (!entry || zipf == null || entry.tags !== 0 || !(entry.sources & LEXICON_SOURCES)) continue;
  const band = BANDS.findIndex((low, i) => i < BANDS.length - 1 && zipf >= low && zipf < BANDS[i + 1]);
  if (band >= 0) byBand[band].push({ word, zipf: Math.round(zipf * 100) / 100 });
}
const anchors = byBand.flatMap((band) => {
  const step = Math.max(1, Math.floor(band.length / PER_BAND));
  return band.filter((_, i) => i % step === 0).slice(0, PER_BAND);
});

const drops = puzzles.map((p) => p.drop.toUpperCase());
const report = {
  date,
  days,
  drops,
  drop: drops.join(", "),
  played: candidates.filter((c) => c.played).length,
  count: candidates.length,
  anchors,
  candidates,
};
const out = arg("out");
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(
  `${date} (${days} puzzle(s), drops ${report.drop}): ${candidates.length} unattested candidate(s), ` +
    `${report.played} of ${played.length} played word(s)`
);
if (!out) for (const c of candidates) console.log(`${c.word}\t${c.drop}\t${c.modes.join(",")}\t${c.standardZipf ?? "-"}`);
