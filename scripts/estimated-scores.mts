/**
 * The score a player would see for each word Claude just estimated, with its
 * estimate applied, so the "Estimate unattested Zipf" PR can show it beside the
 * Zipf. Every one of these words scores 10.00 without an estimate, so the
 * estimated score is the only one worth showing -- including for the words
 * `estimate-zipf.py record` held back for low confidence, which a reviewer may
 * want to judge.
 *
 * `--estimates` is record's `--validated-out`: every well-formed estimate as
 * `{ word: zipf }`. They are laid over src/data/estimated-zipf.json as one
 * batch for the puzzle, and every asked word goes back through the game's own
 * `evaluateSubmission` for that puzzle, in both modes, so Standard's fold is
 * applied exactly as it would be in play.
 *
 *   ./node_modules/.bin/vite-node scripts/estimated-scores.mts -- \
 *     --asked .tmp/asked.json --estimates .tmp/validated.json --out .tmp/scores.json
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
const { formatRarityScore, setEstimatedZipfForTests } = await import("../src/game/dictionary.ts");
const estimatedZipfData = (await import("../src/data/estimated-zipf.json")).default;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const askedPath = arg("asked");
const estimatesPath = arg("estimates");
const out = arg("out");
if (!askedPath || !estimatesPath || !out) {
  console.error(
    "usage: estimated-scores.mts --asked .tmp/asked.json --estimates .tmp/validated.json --out .tmp/scores.json"
  );
  process.exit(2);
}

if (!(await loadCorpus())) {
  console.error("could not load public/corpus");
  process.exit(1);
}

const report = JSON.parse(readFileSync(askedPath, "utf8")) as {
  date: string;
  drop: string;
  asked: { word: string }[];
};
const drop = report.drop.toLowerCase();

// Apply every estimate, recorded or not. The hook is the tests' way of swapping
// the batches; this script is a one-shot process, so nothing else sees it.
const estimates = JSON.parse(readFileSync(estimatesPath, "utf8")) as Record<string, number>;
setEstimatedZipfForTests([
  ...(estimatedZipfData as { batches: Parameters<typeof setEstimatedZipfForTests>[0] }).batches,
  { since: report.date, drop: report.drop, model: "claude", zipf: estimates },
]);

type Shown = { zipf: number; score: string; rarity: string } | null;
const scores: Record<string, { standard: Shown; freeform: Shown }> = {};
for (const { word } of report.asked) {
  const shown = (mode: "standard" | "freeform"): Shown => {
    const result = asMode(mode, () => evaluateSubmission(word, drop, [], report.date));
    if (!result.ok || !result.word) return null;
    const { zipf, rarity } = result.word;
    return { zipf, score: formatRarityScore(zipf, report.date), rarity };
  };
  scores[word] = { standard: shown("standard"), freeform: shown("freeform") };
}

writeFileSync(out, JSON.stringify(scores, null, 2) + "\n");
console.log(`Scored ${report.asked.length} word(s) for ${report.date} (${report.drop}).`);
