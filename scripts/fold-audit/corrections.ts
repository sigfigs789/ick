/** Every fold corrected by the 50k pass, before and after the fix date. */
import { readFileSync, writeFileSync } from "node:fs";
import { loadCorpus } from "../../src/game/corpus";
import { foldTrace, rarityScore, rarityForZipf } from "../../src/game/dictionary";
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
const BEFORE = "2026-09-30";
const AFTER = "2026-10-01";
async function main(): Promise<void> {
  setMode("standard"); serve(); await loadCorpus();
  const rows = JSON.parse(readFileSync("scripts/fold-audit/out/confirmed.json", "utf8"));
  const out: string[] = ["word\twas\tnow\trule\tscoreBefore\trankBefore\tscoreAfter\trankAfter\tstatus\twhy"];
  let stillWrong = 0;
  for (const r of rows) {
    const b = foldTrace(r.word, BEFORE);
    const a = foldTrace(r.word, AFTER);
    const wrong = a?.base === r.base;
    if (wrong) stillWrong++;
    const sBefore = b ? rarityScore(b.baseZipf, BEFORE) : NaN;
    const own = b ? rarityScore(b.ownZipf, AFTER) : NaN;
    const sAfter = a ? rarityScore(a.baseZipf, AFTER) : own;
    out.push([
      r.word, b?.base ?? "(none)", a?.base ?? "(own score)", r.rule,
      sBefore.toFixed(2), b ? rarityForZipf(b.baseZipf, BEFORE) : "",
      sAfter.toFixed(2), a ? rarityForZipf(a.baseZipf, AFTER) : rarityForZipf(b!.ownZipf, AFTER),
      wrong ? "STILL WRONG" : "corrected", r.verify,
    ].join("\t"));
  }
  writeFileSync("scripts/fold-audit/out/corrections.tsv", out.join("\n") + "\n");
  console.log(`${rows.length} confirmed; corrected ${rows.length - stillWrong}, still wrong ${stillWrong}`);
}
main();
