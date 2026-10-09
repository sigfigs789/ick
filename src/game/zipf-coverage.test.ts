// @ts-expect-error -- Node builtin; this app has no @types/node, but the module
// is available at runtime under vitest (Node).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { corpusEntry, loadCorpus } from "./corpus";
import { estimatedZipfEntry, rarityFor, unattestedZipf } from "./dictionary";
import curated from "../data/dictionary.json";
import estimatedZipfData from "../data/estimated-zipf.json";

/**
 * How much of the lexicon has a frequency, tracked in src/data/zipf-coverage.json.
 *
 * Every word in the curated list and the corpus is one of:
 *   - measured:   a frequency corpus attests it;
 *   - estimated:  no corpus does, but Claude has guessed a Zipf for it
 *                 (src/data/estimated-zipf.json, the "Estimate unattested Zipf"
 *                 workflow);
 *   - unattested: neither, so it still scores the sentinel, a flat 10.00.
 *
 * Each sweep moves words from unattested to estimated, so the snapshot changes
 * with every estimate PR -- that is the point: the diff is the sweep's progress.
 * The `drops` ledger lists every drop an estimate batch was asked to cover, with
 * how many lexicon words containing it are estimated and how many are still
 * unattested, so a drop that was only partly swept (a run that hit the
 * subscription's usage limit) shows as such rather than as done.
 *
 * Counts are over the raw lexicon, not what a puzzle accepts: a word the word
 * rules reject is still counted here. Update with
 *   npx vitest run -u src/game/zipf-coverage.test.ts
 */

function serveShippedCorpus(): void {
  const base = "public/corpus";
  const meta = JSON.parse(readFileSync(`${base}/meta.json`, "utf8"));
  const words = readFileSync(`${base}/words.txt`, "utf8");
  const bin = (name: string) => {
    const b = readFileSync(`${base}/${name}`) as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body = url.includes("meta.json")
        ? { json: () => Promise.resolve(meta) }
        : url.includes("words.txt")
          ? { text: () => Promise.resolve(words) }
          : { arrayBuffer: () => Promise.resolve(bin(url.split("/").pop()!.split("?")[0])) };
      return Promise.resolve({ ok: true, ...body } as unknown as Response);
    })
  );
}

/** Every corpus word, decoded from the front-coded list as corpus.ts does. */
function corpusWords(): string[] {
  const lines = (readFileSync("public/corpus/words.txt", "utf8") as string).split("\n");
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

type Status = "measured" | "estimated" | "unattested";

const CURATED = new Set(curated as string[]);
const batches = (estimatedZipfData as unknown as { batches: { since: string; drop: string; zipf: object }[] })
  .batches;

beforeAll(async () => {
  serveShippedCorpus();
  expect(await loadCorpus()).toBe(true);
}, 60_000);

describe("Zipf coverage of the lexicon", () => {
  it("matches src/data/zipf-coverage.json", async () => {
    const sentinel = unattestedZipf();
    const words = new Set<string>([...CURATED, ...corpusWords()]);

    // A word's own measurement, before any estimate: the curated rarity table
    // for curated words, the corpus waterfall for the rest.
    const statusOf = (word: string): Status => {
      const own = CURATED.has(word)
        ? rarityFor(word, undefined, "freeform")?.zipf
        : (corpusEntry(word)?.zipf ?? sentinel);
      const estimate = estimatedZipfEntry(word);
      if (estimate) {
        // Measured words are never estimated; if one were, the measurement wins.
        return own === undefined || own === sentinel || own === estimate.zipf ? "estimated" : "measured";
      }
      return own === undefined || own === sentinel ? "unattested" : "measured";
    };

    // Every drop a batch was asked about, in the order batches first named it.
    const drops: string[] = [];
    for (const batch of batches)
      for (const drop of batch.drop.split(",").map((d) => d.trim().toLowerCase()))
        if (drop && !drops.includes(drop)) drops.push(drop);

    const totals: Record<Status, number> = { measured: 0, estimated: 0, unattested: 0 };
    const perDrop = new Map(drops.map((d) => [d, { estimated: 0, unattested: 0 }]));
    for (const word of words) {
      const status = statusOf(word);
      totals[status]++;
      if (status === "measured") continue;
      for (const drop of drops) if (word.includes(drop)) perDrop.get(drop)![status]++;
    }

    const coverage = {
      words: words.size,
      ...totals,
      batches: batches.map((b) => ({ since: b.since, estimates: Object.keys(b.zipf).length })),
      drops: Object.fromEntries(
        drops.map((d) => {
          const { estimated, unattested } = perDrop.get(d)!;
          const total = estimated + unattested;
          return [
            d.toUpperCase(),
            { estimated, unattested, swept: total ? `${((100 * estimated) / total).toFixed(1)}%` : "-" },
          ];
        })
      ),
    };
    await expect(JSON.stringify(coverage, null, 2) + "\n").toMatchFileSnapshot("../data/zipf-coverage.json");
  }, 120_000);
});
