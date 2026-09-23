/**
 * How many distinct *questions* the fold population actually asks.
 *
 * "jowly", "jowlier", "jowliest", "jowliness" and "jowlinesses" all folding onto
 * "jow" is one judgement, not five: they share a root and they share a base.
 * `sameRootKey` is the function the game already uses to decide that two
 * submissions are the same word, so it is the right collapser here too.
 *
 * The representative kept for each family is its highest-harm member. If one of
 * a family is going to be judged, it should be the one that costs the most.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadCorpus } from "../../src/game/corpus";
import { setMode } from "../../src/game/mode";
import { sameRootKey } from "../../src/game/submit";

function serve(): void {
  const base = "public/corpus";
  const meta = JSON.parse(readFileSync(`${base}/meta.json`, "utf8"));
  const words = readFileSync(`${base}/words.txt`, "utf8");
  const bin = (n: string) => {
    const b = readFileSync(`${base}/${n}`) as {
      buffer: ArrayBuffer;
      byteOffset: number;
      byteLength: number;
    };
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  globalThis.fetch = ((url: string) => {
    const body = url.includes("meta.json")
      ? { json: () => Promise.resolve(meta) }
      : url.includes("words.txt")
        ? { text: () => Promise.resolve(words) }
        : { arrayBuffer: () => Promise.resolve(bin(url.split("/").pop()!.split("?")[0])) };
    return Promise.resolve({ ok: true, ...body } as unknown as Response);
  }) as typeof fetch;
}

async function main(): Promise<void> {
  setMode("standard");
  serve();
  await loadCorpus();

  const lines = readFileSync("scripts/fold-audit/out/folds.tsv", "utf8").split("\n");
  const header = lines[0].split("\t");
  const col = (name: string) => header.indexOf(name);
  const SEP = String.fromCharCode(0);

  const groups = new Map<string, { rep: string[]; n: number; maxDelta: number }>();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const f = line.split("\t");
    const delta = Number(f[col("delta")]);
    const key = `${sameRootKey(f[col("word")], "2026-10-01")}${SEP}${f[col("base")]}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { rep: f, n: 1, maxDelta: delta });
    } else {
      g.n++;
      if (delta > g.maxDelta) {
        g.maxDelta = delta;
        g.rep = f;
      }
    }
  }

  const reps = [...groups.values()].sort((a, b) => b.maxDelta - a.maxDelta);
  const total = reps.reduce((s, g) => s + g.n, 0);
  writeFileSync(
    "scripts/fold-audit/out/folds-deduped.tsv",
    [`${lines[0]}\tfamily`, ...reps.map((g) => `${g.rep.join("\t")}\t${g.n}`)].join("\n") + "\n"
  );
  console.log(
    `${total} folds -> ${reps.length} distinct questions (${((100 * reps.length) / total).toFixed(1)}%)`
  );
  // Reduced rather than spread: 200k arguments overflows the call stack.
  console.log(`largest family: ${reps.reduce((m, g) => (g.n > m ? g.n : m), 0)}`);
}

main();
