/**
 * Every fold the audit called wrong, before and after the fix date.
 *
 * Writes the ledger a reviewer samples from: what each word folded to, what it
 * folds to now, and what that did to its score.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadCorpus } from "../../src/game/corpus";
import { foldTrace, rarityScore } from "../../src/game/dictionary";
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
  const flagged: { word: string; base: string; why: string }[] = [];
  for (const line of readFileSync("scripts/fold-audit/out/fold-review.md", "utf8").split("\n")) {
    if (!line.startsWith("| `")) continue;
    const p = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/`/g, ""));
    if (p.length < 6 || p[4] !== "different") continue;
    flagged.push({ word: p[0], base: p[1], why: p[5] });
  }

  const rows: string[] = [];
  let fixed = 0;
  for (const f of flagged) {
    const before = foldTrace(f.word, BEFORE);
    const after = foldTrace(f.word, AFTER);
    const stillWrong = after?.base === f.base;
    if (!stillWrong) fixed++;
    const score = (t: ReturnType<typeof foldTrace>, date: string) =>
      t ? rarityScore(t.baseZipf, date).toFixed(2) : before ? rarityScore(before.ownZipf, date).toFixed(2) : "--";
    rows.push(
      [
        f.word,
        before?.base ?? "(none)",
        after?.base ?? "(own score)",
        score(before, BEFORE),
        score(after, AFTER),
        stillWrong ? "STILL WRONG" : "fixed",
        f.why,
      ].join("\t")
    );
  }
  writeFileSync("scripts/fold-audit/out/fixes.tsv",
    "word\twas\tnow\tscoreBefore\tscoreAfter\tstatus\tjudgeReason\n" + rows.join("\n") + "\n");
  console.log(`flagged ${flagged.length}  fixed ${fixed}  still wrong ${flagged.length - fixed}`);
}
main();
