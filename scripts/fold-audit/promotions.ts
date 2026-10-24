import { readFileSync } from "node:fs";
import { loadCorpus } from "../../src/game/corpus";
import { baseFormSubstitution, rarityFor, scoringReady } from "../../src/game/dictionary";
import { setMode } from "../../src/game/mode";
import curated from "../../src/data/dictionary.json";
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
  setMode("standard"); serve(); await loadCorpus(); await scoringReady();
  const BEFORE = "2026-09-30";
  const AFTER = "2026-10-01";
  const ups: { word: string; b: number; a: number; base?: string }[] = [];
  for (const word of curated as string[]) {
    const b = rarityFor(word, BEFORE)!.zipf;
    const a = rarityFor(word, AFTER)!.zipf;
    if (a < b) ups.push({ word, b, a, base: baseFormSubstitution(word, AFTER)?.base });
  }
  const downs: { word: string; base?: string }[] = [];
  for (const word of curated as string[]) {
    if (rarityFor(word, AFTER)!.zipf > rarityFor(word, BEFORE)!.zipf) {
      downs.push({ word, base: baseFormSubstitution(word, AFTER)?.base });
    }
  }
  const down = downs.length;
  console.log("--- demotions (the rule finding a base it should have) ---");
  for (const d of downs) console.log(`  ${d.word.padEnd(18)} now: ${d.base ?? "(own)"}`);
  console.log("promotions:", ups.length, " demotions:", down, " ratio 1:", Math.floor(down / ups.length));
  for (const u of ups) console.log(`  ${u.word.padEnd(20)} ${u.b.toFixed(2)} -> ${u.a.toFixed(2)}  now: ${u.base ?? "(own score)"}`);
}
main();
