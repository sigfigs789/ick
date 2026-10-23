/**
 * The score a player will see for each word Claude just estimated, so the
 * "Estimate unattested Zipf" PR can show it beside the Zipf. Every one of these
 * words scores 10.00 without an estimate, so the estimated score is the one
 * worth showing.
 *
 * Run after `estimate-zipf.py record` has written the batch to
 * src/data/estimated-zipf/: every asked word goes back through the game's
 * own `evaluateSubmission` on the batch's puzzle, in both modes, against the
 * drop unattested-candidates.mts found it under, so Standard's fold is applied
 * exactly as it will be in play.
 *
 *   ./node_modules/.bin/vite-node scripts/estimated-scores.mts -- \
 *     --asked .tmp/asked.json --out .tmp/scores.json
 *
 * Writes `{ word: { standard, freeform } }`, each mode either null (that mode
 * does not accept the word) or `{ zipf, score, rarity }` with `score` formatted
 * as the game shows it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// The corpus loads over fetch in the browser; serve public/ off disk instead.
globalThis.fetch = (async (input: string | URL) => {
  const path = String(input).split("?")[0].replace(/^\//, "");
  const body = readFileSync(resolve(root, "public", path));
  return new Response(body);
}) as typeof fetch;

const { loadCorpus } = await import("../src/game/corpus.ts");
const { evaluateSubmission } = await import("../src/game/submit.ts");
const { asMode } = await import("../src/game/mode.ts");
const { formatRarityScore } = await import("../src/game/dictionary.ts");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const askedPath = arg("asked");
const out = arg("out");
if (!askedPath || !out) {
  console.error("usage: estimated-scores.mts --asked .tmp/asked.json --out .tmp/scores.json");
  process.exit(2);
}

if (!(await loadCorpus())) {
  console.error("could not load public/corpus");
  process.exit(1);
}

const report = JSON.parse(readFileSync(askedPath, "utf8")) as {
  date: string;
  asked: { word: string; drop: string }[];
};

type Shown = { zipf: number; score: string; rarity: string } | null;
const scores: Record<string, { standard: Shown; freeform: Shown }> = {};
for (const { word, drop } of report.asked) {
  const shown = (mode: "standard" | "freeform"): Shown => {
    const result = asMode(mode, () => evaluateSubmission(word, drop.toLowerCase(), [], report.date));
    if (!result.ok || !result.word) return null;
    const { zipf, rarity } = result.word;
    return { zipf, score: formatRarityScore(zipf, report.date), rarity };
  };
  scores[word] = { standard: shown("standard"), freeform: shown("freeform") };
}

writeFileSync(out, JSON.stringify(scores, null, 2) + "\n");
console.log(`Scored ${report.asked.length} word(s) on ${report.date}.`);
