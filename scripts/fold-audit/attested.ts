/** The confirmed words that either lexicon actually holds; the pin requires it. */
import { readFileSync, writeFileSync } from "node:fs";
import { corpusAttests, loadCorpus } from "../../src/game/corpus";
import { scoringReady } from "../../src/game/dictionary";
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
  const CUR = new Set(curated as string[]);
  const rows = JSON.parse(readFileSync("scripts/fold-audit/out/confirmed.json", "utf8"));
  const ok = rows.map((r: { word: string }) => r.word).filter((w: string) => CUR.has(w) || corpusAttests(w));
  writeFileSync("scripts/fold-audit/out/attested.txt", ok.join("\n") + "\n");
  console.log(`${ok.length} of ${rows.length} confirmed words are in a lexicon`);
}
main();
