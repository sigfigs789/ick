/**
 * What the game itself makes of each word waiting on /suggested-words, so the
 * daily suggestion review (.github/workflows/review-suggested-words.yml) judges
 * from facts rather than from Claude's memory of the dictionary.
 *
 * Run with vite-node so the answers come from the game's own code: each word
 * goes through `evaluateSubmission` in both modes under `--date`'s rules, with
 * its own first two letters as the drop (whether a word plays does not depend
 * on the drop, as long as it contains it).
 *
 *   ./node_modules/.bin/vite-node scripts/suggestion-review/facts.mts -- \
 *     --queue .tmp/queue.json --date 2026-10-28 --out .tmp/facts.json
 *
 * `--queue` is the rows `list_suggested_words` returns (only `word` is needed;
 * the rest is passed through for the judge). Run again after the accepted words
 * are added, with `--out` elsewhere, to check every acceptance now plays.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

// The corpus loads over fetch in the browser; serve public/ off disk instead.
globalThis.fetch = (async (input: string | URL) => {
  const path = String(input).split("?")[0].replace(/^\//, "");
  return new Response(readFileSync(resolve(root, "public", path)));
}) as typeof fetch;

const { loadCorpus, corpusEntry, sourcesOf, tagsOf } = await import("../../src/game/corpus.ts");
const { evaluateSubmission, rejectionMetadataReady } = await import("../../src/game/submit.ts");
const { asMode } = await import("../../src/game/mode.ts");
const { curatedRejection, scoringReady, formatRarityScore, isUnattestedZipf } =
  await import("../../src/game/dictionary.ts");
const dictionary = new Set((await import("../../src/data/dictionary.json")).default as string[]);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const queuePath = arg("queue");
const date = arg("date");
const out = arg("out");
if (!queuePath || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !out) {
  console.error("usage: facts.mts --queue queue.json --date YYYY-MM-DD --out facts.json");
  process.exit(2);
}

await scoringReady();
await rejectionMetadataReady;
if (!(await loadCorpus())) {
  console.error("could not load public/corpus");
  process.exit(1);
}

type Row = Record<string, unknown> & { word: string };
const queue = (JSON.parse(readFileSync(queuePath, "utf8")) as Row[]).filter(
  (row) => typeof row.word === "string" && /^[a-z]{2,30}$/.test(row.word)
);

function verdict(word: string, mode: "standard" | "freeform") {
  const result = asMode(mode, () => evaluateSubmission(word, word.slice(0, 2), [], date));
  if (!result.ok || !result.word) return { plays: false, reason: result.reason ?? "not-a-word" };
  const zipf = result.word.zipf;
  const unattested = isUnattestedZipf(zipf);
  return {
    plays: true,
    score: unattested ? "10.00 (unattested)" : formatRarityScore(zipf, date),
    rarity: result.word.rarity,
    zipf: unattested ? null : Math.round(zipf * 100) / 100,
  };
}

const facts = queue.map((row) => {
  const entry = corpusEntry(row.word);
  const standard = verdict(row.word, "standard");
  const freeform = verdict(row.word, "freeform");
  return {
    ...row,
    inCuratedDictionary: dictionary.has(row.word),
    corpus: entry
      ? {
          sources: sourcesOf(entry.sources),
          tags: tagsOf(entry.tags),
          zipf: entry.zipf == null ? null : Math.round(entry.zipf * 100) / 100,
        }
      : null,
    reviewedRejection: curatedRejection(row.word, date) ?? null,
    standard,
    freeform,
    alreadyPlayable: standard.plays && freeform.plays,
    // The word's own frequency as the game knows it -- Freeform does not fold,
    // so its Zipf is the word's own -- or the corpus's when it does not play.
    // Null is a word nothing measures, which the judge estimates.
    measuredZipf: (freeform.plays ? freeform.zipf : entry?.zipf != null ? Math.round(entry.zipf * 100) / 100 : null) ?? null,
  };
});

writeFileSync(out, JSON.stringify({ date, count: facts.length, words: facts }, null, 2) + "\n");
console.log(
  `${facts.length} word(s) on ${date}: ${facts.filter((f) => f.alreadyPlayable).length} already play in both modes`
);
