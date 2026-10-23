/**
 * Prototype of a per-drop word slice: every answer one puzzle can accept,
 * already scored, so a client could play that puzzle without the dictionary.
 *
 * Feasibility groundwork for moving the dictionary off the client (see
 * docs/dictionary-on-server.md). Nothing in the app reads these slices yet.
 *
 * Each candidate is every curated or corpus word containing the drop. It goes
 * through the game's own `evaluateSubmission` on the puzzle's date, in both
 * modes, with nothing accepted yet, so a slice carries exactly the verdict and
 * score the game would give. Same-root refusal is not modelled: it ended on
 * 2026-10-05, so only archived puzzles use it.
 *
 *   ./node_modules/.bin/vite-node scripts/drop-slices.mts -- \
 *     [--from 2026-10-23] [--days 3] [--out .tmp/slices]
 *
 * Prints word count, raw and gzipped size, and build time per puzzle. With
 * `--out`, also writes one `<date>.json` per puzzle:
 *
 *   { date, drop, words: { word: [standard, freeform] } }
 *
 * where each mode is a Zipf in hundredths (accepted) or a rejection reason
 * string. A word both modes reject with `not-a-word` is left out: a missing
 * word means "not a word".
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");

// The corpus loads over fetch in the browser; serve public/ off disk instead.
globalThis.fetch = (async (input: string | URL) => {
  const path = String(input).split("?")[0].replace(/^\//, "");
  return new Response(readFileSync(resolve(root, "public", path)));
}) as typeof fetch;

const { loadCorpus } = await import("../src/game/corpus.ts");
const { evaluateSubmission } = await import("../src/game/submit.ts");
const { asMode } = await import("../src/game/mode.ts");
const { dropForDate } = await import("../src/game/drop.ts");
const { addDays, todayDateString } = await import("../src/game/date.ts");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const from = arg("from") ?? todayDateString();
const days = Number(arg("days") ?? 3);
const out = arg("out");

if (!(await loadCorpus())) {
  console.error("could not load public/corpus");
  process.exit(1);
}

/** words.txt is front-coded: one digit of shared prefix, then the rest. */
function corpusWords(): string[] {
  const lines = readFileSync(resolve(root, "public/corpus/words.txt"), "utf8").split("\n");
  const words: string[] = [];
  let previous = "";
  for (const line of lines) {
    if (!line) continue;
    previous = previous.slice(0, line.charCodeAt(0) - 48) + line.slice(1);
    words.push(previous);
  }
  return words;
}

const curated = JSON.parse(readFileSync(resolve(root, "src/data/dictionary.json"), "utf8")) as string[];
const everyWord = [...new Set([...curated, ...corpusWords()])];

type Verdict = number | string;

function verdict(word: string, drop: string, date: string, mode: "standard" | "freeform"): Verdict {
  const result = asMode(mode, () => evaluateSubmission(word, drop, [], date));
  if (result.ok && result.word) return Math.round(result.word.zipf * 100);
  return result.ok ? "not-a-word" : result.reason;
}

if (out) mkdirSync(resolve(root, out), { recursive: true });

console.log("date        drop  candidates  kept    raw KB  gzip KB  seconds");
for (let d = 0; d < days; d++) {
  const date = addDays(from, d);
  const drop = dropForDate(date).toLowerCase();
  const started = performance.now();
  const candidates = everyWord.filter((word) => word.includes(drop));
  const words: Record<string, [Verdict, Verdict]> = {};
  for (const word of candidates) {
    const pair: [Verdict, Verdict] = [
      verdict(word, drop, date, "standard"),
      verdict(word, drop, date, "freeform"),
    ];
    if (pair[0] === "not-a-word" && pair[1] === "not-a-word") continue;
    words[word] = pair;
  }
  const seconds = (performance.now() - started) / 1000;
  const body = JSON.stringify({ date, drop, words });
  const kept = Object.keys(words).length;
  console.log(
    [
      date,
      drop.toUpperCase().padEnd(4),
      String(candidates.length).padStart(10),
      String(kept).padStart(6),
      (body.length / 1024).toFixed(0).padStart(9),
      (gzipSync(body).length / 1024).toFixed(0).padStart(8),
      seconds.toFixed(1).padStart(8),
    ].join("  ")
  );
  if (out) writeFileSync(resolve(root, out, `${date}.json`), body + "\n");
}
