/**
 * Every fold a player can reach in the next few drops, with the rule that made
 * it and what it cost.
 *
 * Run: `npx vite-node scripts/fold-audit/dump-folds.ts -- 2026-09-23 2026-09-24 2026-09-25`
 *
 * Off the TS engine with the real corpus loaded, which is the whole point of it
 * existing next to `scripts/fold-disagreements.py`: the Python mirror in
 * manage-extra-word.py scores off the curated list alone, so it cannot see a
 * fold whose base is corpus-only -- and since CORPUS_ONLY_START most of them
 * are. Output is a TSV for `judge.ts` to screen.
 */

// @ts-expect-error -- Node builtins; this app has no @types/node, but vite-node
// runs under Node. Same dodge as src/game/corpus-lexicon.test.ts.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
// @ts-expect-error -- as above.
import { argv, stderr } from "node:process";

import { loadCorpus } from "../../src/game/corpus";
import { foldTrace, rarityScore, rarityForZipf } from "../../src/game/dictionary";
import { dropForDate } from "../../src/game/drop";
import { setMode } from "../../src/game/mode";
import { evaluateSubmission } from "../../src/game/submit";
import { describeHop, riskiestRule } from "./rules";

/** The shipped corpus, served to `loadCorpus` off disk. */
function serveShippedCorpus(): void {
  const base = "public/corpus";
  const meta = JSON.parse(readFileSync(`${base}/meta.json`, "utf8"));
  const words = readFileSync(`${base}/words.txt`, "utf8");
  const bin = (name: string) => {
    const b = readFileSync(`${base}/${name}`) as {
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

/**
 * The front-coded word list, expanded. A copy of `expand` in corpus.ts rather
 * than an import because that module keeps its decoded form private and hands
 * out lookups, not an iterator -- and an audit needs the population itself.
 */
function corpusWords(): string[] {
  const lines = readFileSync("public/corpus/words.txt", "utf8").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const out: string[] = new Array(lines.length);
  let previous = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const word = previous.slice(0, line.charCodeAt(0) - 48) + line.slice(1);
    out[i] = word;
    previous = word;
  }
  return out;
}

const TSV_HEADER = [
  "date",
  "drop",
  "word",
  "base",
  "rule",
  "rules",
  "path",
  "ownZipf",
  "baseZipf",
  "scoreBefore",
  "scoreAfter",
  "delta",
  "rankBefore",
  "rankAfter",
].join("\t");

async function main(): Promise<void> {
  const dates = argv.slice(2).filter((a: string) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (dates.length === 0) {
    stderr.write("usage: vite-node dump-folds.ts -- YYYY-MM-DD [YYYY-MM-DD ...]\n");
    return;
  }

  // From MODE_CHOICE_START the fold is a property of the player's mode, not of
  // the calendar, and `currentMode` in a script has no player to ask. Standard
  // is the mode that folds and the mode the leaderboard ranks, so it is the one
  // an audit of the fold means. Freeform's answer is "nothing folds".
  setMode("standard");

  serveShippedCorpus();
  const ok = await loadCorpus();
  if (!ok) throw new Error("corpus failed to load");

  const words = corpusWords();
  stderr.write(`corpus: ${words.length} words\n`);

  const rows: string[] = [];
  // "all" in place of a drop: every playable word in the lexicon, not just the
  // ones a given puzzle can reach. An empty needle passes containsDropInOrder
  // for every word, so the rest of evaluateSubmission's gate still applies.
  const everything = argv.includes("--all");
  for (const date of dates) {
    const drop = everything ? "" : dropForDate(date);
    const needle = drop.toLowerCase();
    let reachable = 0;
    let folded = 0;
    for (const word of words) {
      if (!word.includes(needle)) continue;
      // The real gate, so the audit sees exactly the words a player sees:
      // blocklist, tags-as-verdicts, rejections, same-as-drop, all of it.
      const verdict = evaluateSubmission(word, drop, [], date);
      if (!verdict.ok) continue;
      reachable++;
      const trace = foldTrace(word, date);
      if (!trace) continue;
      const before = rarityScore(trace.ownZipf, date);
      const after = rarityScore(trace.baseZipf, date);
      const delta = before - after;
      // A fold that does not move the displayed score costs the player nothing,
      // and nothing is what a wrong one would cost too. Not worth a judge call.
      if (delta < 0.005) continue;
      folded++;
      rows.push(
        [
          date,
          drop,
          word,
          trace.base,
          riskiestRule(trace.path),
          trace.path.map((h) => describeHop(h)).join(">"),
          [word, ...trace.path.map((h) => h.to)].join(">"),
          trace.ownZipf.toFixed(2),
          trace.baseZipf.toFixed(2),
          before.toFixed(2),
          after.toFixed(2),
          delta.toFixed(2),
          rarityForZipf(trace.ownZipf, date),
          rarityForZipf(trace.baseZipf, date),
        ].join("\t")
      );
    }
    stderr.write(`${date} ${drop}: ${reachable} playable, ${folded} score-lowering folds\n`);
  }

  mkdirSync("scripts/fold-audit/out", { recursive: true });
  writeFileSync("scripts/fold-audit/out/folds.tsv", [TSV_HEADER, ...rows].join("\n") + "\n");
  stderr.write(`wrote ${rows.length} rows to scripts/fold-audit/out/folds.tsv\n`);
}

main();
