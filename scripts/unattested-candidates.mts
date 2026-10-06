/**
 * List the words a puzzle can accept that no frequency corpus measures -- the
 * ones that score the unattested sentinel (a flat 10.00 Legend before any fold)
 * -- so the "Estimate unattested Zipf" workflow can hand them to Claude for a
 * guessed frequency. See src/data/estimated-zipf.json.
 *
 * Run with vite-node so the answer comes from the game's own code rather than a
 * mirror of it: every word in the curated list and the corpus that contains the
 * drop goes through `evaluateSubmission` in both modes, and a word is a
 * candidate when either mode accepts it on a sentinel Zipf of its own.
 *
 *   ./node_modules/.bin/vite-node scripts/unattested-candidates.mts -- --date 2026-10-08
 *   ./node_modules/.bin/vite-node scripts/unattested-candidates.mts -- --date 2026-10-08 --out .tmp/candidates.json
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
const { unattestedZipf, estimatedZipfEntry } = await import("../src/game/dictionary.ts");
const dictionary = (await import("../src/data/dictionary.json")).default as string[];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const date = arg("date");
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("usage: unattested-candidates.mts --date YYYY-MM-DD [--drop XY] [--out file.json]");
  process.exit(2);
}
const drop = (arg("drop") ?? dropForDate(date)).toLowerCase();

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
const candidates: {
  word: string;
  /** Which modes accept it on a sentinel Zipf of its own. */
  modes: ("standard" | "freeform")[];
  /** The score Standard shows after the fold, when the fold moves it. */
  standardZipf: number | null;
  /** Lexicons that vouch for it, for Claude's context. */
  sources: string[];
}[] = [];

for (const word of [...dictionary, ...corpusWords()]) {
  if (seen.has(word) || !word.includes(drop)) continue;
  seen.add(word);
  const estimate = estimatedZipfEntry(word);
  if (estimate && estimate.since <= date) continue;

  const modes: ("standard" | "freeform")[] = [];
  let standardZipf: number | null = null;
  for (const mode of ["standard", "freeform"] as const) {
    const result = asMode(mode, () => evaluateSubmission(word, drop, [], date));
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
    if (own != null) continue;
  }
  if (modes.length === 0) continue;

  const entry = corpusEntry(word);
  const sources = entry
    ? CORPUS_SOURCES.filter((_, bit) => entry.sources & (1 << bit))
    : ["dictionary"];
  candidates.push({ word, modes, standardZipf, sources });
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

const report = { date, drop: drop.toUpperCase(), count: candidates.length, anchors, candidates };
const out = arg("out");
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(`${date} drop ${drop.toUpperCase()}: ${candidates.length} unattested candidate(s)`);
if (!out) for (const c of candidates) console.log(`${c.word}\t${c.modes.join(",")}\t${c.standardZipf ?? "-"}`);
