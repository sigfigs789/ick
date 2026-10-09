// @ts-expect-error -- Node builtin; this app has no @types/node, but the module
// is available at runtime under vitest (Node).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { corpusEntry, loadCorpus } from "./corpus";
import { estimatedZipfEntry, rarityFor, unattestedZipf } from "./dictionary";
import { addDays } from "./date";
import { asMode } from "./mode";
import { evaluateSubmission } from "./submit";
import curated from "../data/dictionary.json";
import estimatedZipfData from "../data/estimated-zipf.json";

/**
 * How much of the lexicon has a frequency, tracked in src/data/zipf-coverage.json.
 *
 * Every word in the curated list and the corpus is one of:
 *   - measured:   a frequency corpus attests it;
 *   - estimated:  no corpus does, but Claude has guessed a Zipf for it
 *                 (src/data/estimated-zipf.json);
 *   - unattested: neither, so wherever it is accepted it scores the sentinel,
 *                 a flat 10.00.
 * Estimated and unattested words are each split by whether the rules of the
 * latest puzzle in the ledger (`rulesDate`) accept them at all, in either mode: a word the word rules refuse (a proper
 * noun, an abbreviation, an obsolete form) never scores, so it needs no
 * estimate, and only the playable unattested count is work left to do.
 *
 * `puzzles` is the ledger of what the sweeps have covered: every puzzle an
 * estimate batch was asked about (a batch's drops run one per day from its
 * `since`), with how many words that puzzle accepts are estimated and how many
 * still score the flat 10.00. A batch names the drops it was asked to cover,
 * not the ones it finished, so this is where a partly swept drop shows.
 *
 * Each sweep moves words from unattested to estimated, so the snapshot changes
 * with every estimate PR -- that is the point: the diff is the sweep's progress.
 * Update with
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
const sentinel = unattestedZipf();

/** Whether a corpus measures `word`, an estimate stands in for it, or neither. */
function statusOf(word: string): Status {
  // The word's own measurement, before any estimate: the curated rarity table
  // for curated words (Freeform, so no fold), the corpus waterfall for the rest.
  const own = CURATED.has(word) ? rarityFor(word, undefined, "freeform")?.zipf : corpusEntry(word)?.zipf;
  const estimate = estimatedZipfEntry(word);
  const unmeasured = own == null || own === sentinel || (estimate !== undefined && own === estimate.zipf);
  if (!unmeasured) return "measured";
  return estimate ? "estimated" : "unattested";
}

/** Whether either mode accepts `word` with `drop` on `date`. */
function accepted(word: string, drop: string, date: string): boolean {
  return (["freeform", "standard"] as const).some((mode) =>
    asMode(mode, () => evaluateSubmission(word, drop, [], date).ok)
  );
}

beforeAll(async () => {
  serveShippedCorpus();
  expect(await loadCorpus()).toBe(true);
}, 60_000);

describe("Zipf coverage of the lexicon", () => {
  it("matches src/data/zipf-coverage.json", async () => {
    const words = [...new Set<string>([...CURATED, ...corpusWords()])];

    // Every puzzle a batch was asked about, by date.
    const puzzles = new Map<string, string>();
    for (const batch of batches)
      batch.drop
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
        .forEach((drop, i) => puzzles.set(addDays(batch.since, i), drop));

    // Playability is judged by the rules of the latest puzzle the ledger covers:
    // the corpus only rules on words for a dated puzzle.
    const rulesDate = [...puzzles.keys()].sort().pop()!;
    const unmeasured: { word: string; status: Exclude<Status, "measured"> }[] = [];
    const totals = {
      measured: 0,
      estimated: { playable: 0, notPlayable: 0 },
      unattested: { playable: 0, notPlayable: 0 },
    };
    for (const word of words) {
      const status = statusOf(word);
      if (status === "measured") {
        totals.measured++;
        continue;
      }
      unmeasured.push({ word, status });
      // Any drop the word contains will do: playability is the word rules'.
      totals[status][accepted(word, word.slice(0, 2), rulesDate) ? "playable" : "notPlayable"]++;
    }

    const ledger = [...puzzles]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, drop]) => {
        let estimated = 0;
        let unattested = 0;
        for (const { word, status } of unmeasured) {
          if (!word.includes(drop.toLowerCase()) || !accepted(word, drop, date)) continue;
          if (status === "estimated") estimated++;
          else unattested++;
        }
        const total = estimated + unattested;
        return {
          date,
          drop,
          estimated,
          unattested,
          swept: total ? `${((100 * estimated) / total).toFixed(1)}%` : "-",
        };
      });

    const coverage = {
      words: words.length,
      rulesDate,
      ...totals,
      batches: batches.map((b) => ({ since: b.since, estimates: Object.keys(b.zipf).length })),
      puzzles: ledger,
    };
    await expect(JSON.stringify(coverage, null, 2) + "\n").toMatchFileSnapshot("../data/zipf-coverage.json");
  }, 600_000);
});
