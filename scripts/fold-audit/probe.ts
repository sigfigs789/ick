import { readFileSync } from "node:fs";
import { corpusAttests, loadCorpus } from "../../src/game/corpus";
import { foldTrace } from "../../src/game/dictionary";
import { setMode } from "../../src/game/mode";
function serve(): void {
  const base = "public/corpus";
  const meta = JSON.parse(readFileSync(`${base}/meta.json`, "utf8"));
  const words = readFileSync(`${base}/words.txt`, "utf8");
  const bin = (n: string) => { const b: any = readFileSync(`${base}/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  globalThis.fetch = ((url: string) => Promise.resolve({ ok: true,
    ...(url.includes("meta.json") ? { json: () => Promise.resolve(meta) }
      : url.includes("words.txt") ? { text: () => Promise.resolve(words) }
      : { arrayBuffer: () => Promise.resolve(bin(url.split("/").pop()!.split("?")[0])) }) } as any)) as any;
}
async function main(): Promise<void> {
  setMode("standard"); serve(); await loadCorpus();
  const D = "2026-09-29";
  const probes = process.argv.slice(2).filter((a) => /^[a-z]+$/.test(a));
  for (const w of probes) {
    const t = foldTrace(w, D);
    console.log(`${w.padEnd(16)} attests=${String(corpusAttests(w)).padEnd(5)} -> ${t ? `${t.base} (${t.path.map((h) => h.to).join(">")})` : "no fold"}`);
  }
}
main();
