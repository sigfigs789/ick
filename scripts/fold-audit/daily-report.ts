/**
 * The pull-request body for the daily fold check: every fold it fixed --
 * redirected to the word's real base, or exempted -- with the score the fold
 * gave the word and the score the word gets now.
 *
 * Run after apply-daily.py has written fold-exemptions.json and
 * fold-review-verdicts.json, in a fresh process so the engine reads the new
 * entries:
 *
 *   npx vite-node scripts/fold-audit/daily-report.ts -- 2026-10-08
 *
 * The "before" score is the dump's, taken before the exemption existed; the
 * "after" one is re-scored through evaluateSubmission, the same gate and price a
 * player gets. A prefix-scoped exemption can leave a word another fold, so the
 * after score is measured rather than assumed to be the word's own.
 */

// @ts-expect-error -- Node builtins; this app has no @types/node, but vite-node
// runs under Node. Same dodge as dump-folds.ts.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
// @ts-expect-error -- as above.
import { argv, stderr } from "node:process";

import { loadCorpus } from "../../src/game/corpus";
import { foldTrace, rarityScore, scoringReady } from "../../src/game/dictionary";
import { dropForDate } from "../../src/game/drop";
import { setMode } from "../../src/game/mode";
import { evaluateSubmission } from "../../src/game/submit";

const OUT = "scripts/fold-audit/out";

/** The shipped corpus, served to `loadCorpus` off disk. As in dump-folds.ts. */
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

/** A tab-separated file with a header row, as records. */
function readTsv(path: string): Record<string, string>[] {
  if (!existsSync(path)) return [];
  const [header, ...lines] = readFileSync(path, "utf8").split("\n").filter((l: string) => l.trim());
  const keys = header.split("\t");
  return lines.map((line: string) => {
    const cells = line.split("\t");
    return Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? "").trim()]));
  });
}

/** Pipes would end a markdown table cell early. */
const cell = (text: string) => text.replace(/\|/g, "\\|");

async function main(): Promise<void> {
  const date = argv.slice(2).find((a: string) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (!date) {
    stderr.write("usage: vite-node daily-report.ts -- YYYY-MM-DD\n");
    return;
  }
  const drop = dropForDate(date);

  setMode("standard");
  serveShippedCorpus();
  await scoringReady();
  if (!(await loadCorpus())) throw new Error("corpus failed to load");

  const folds = new Map(
    readTsv(`${OUT}/folds.tsv`)
      .filter((r) => r.date === date)
      .map((r) => [r.word, r])
  );
  const flagged = readTsv(`${OUT}/daily/flagged.tsv`);
  const confirmed = new Map(
    readTsv(`${OUT}/daily/confirmed.tsv`)
      .filter((r) => folds.has(r.word))
      .map((r) => [r.word, r])
  );
  const lines = (path: string): string[] =>
    existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
  const applied = lines(`${OUT}/daily/applied.txt`);
  const redirected = new Set(lines(`${OUT}/daily/redirected.txt`));

  const rows: string[] = [];
  const unmoved: string[] = [];
  for (const word of applied) {
    const fold = folds.get(word)!;
    const verdict = evaluateSubmission(word, drop, [], date);
    const after = verdict.word ? rarityScore(verdict.word.zipf, date) : NaN;
    const folded = Number(fold.scoreAfter);
    const still = foldTrace(word, date);
    const named = confirmed.get(word)?.base;
    // An exemption exists to lift the score the fold gave it. A redirect can move
    // it either way -- `choping` scored as `chope` is rarer than as `chop` -- so
    // what it must do is land on the base it named.
    if (redirected.has(word) ? still?.base !== named : !(after > folded + 0.005)) {
      unmoved.push(word);
    }
    const path = fold.path.split(">").map((w: string) => `\`${w}\``).join(" → ");
    const scope = confirmed.get(word)?.scope === "prefix" ? " (prefix hop only)" : "";
    const fix = redirected.has(word) ? `scored as \`${named}\`` : "exempt";
    const where =
      still && !(redirected.has(word) && still.base === named)
        ? ` (still folds to \`${still.base}\`)`
        : "";
    rows.push(
      `| \`${word}\` | ${path}${scope} | ${fix} | ${folded.toFixed(2)} ${fold.rankAfter} | ` +
        `**${after.toFixed(2)}** ${verdict.word?.rarity ?? "?"}${where} | ` +
        `${cell(confirmed.get(word)?.reason ?? "")} |`
    );
  }

  const overturned = flagged.filter((r) => !confirmed.has(r.word));
  const body = [
    `Daily fold check for the **${date}** puzzle, drop \`${drop}\`, Standard mode.`,
    "",
    `Every playable answer containing \`${drop}\` whose fold lowers its score was judged: ` +
      `does the base the fold lands on mean what the word means? ` +
      `${folds.size} folds judged, ${flagged.length} flagged, ${confirmed.size} confirmed on ` +
      `adversarial re-review. ${redirected.size} redirected to the word's real base in ` +
      `\`src/data/fold-review-verdicts.json\` (the base already has a measured score), ` +
      `${applied.length - redirected.size} exempted in \`src/data/fold-exemptions.json\` ` +
      `(no base named, or none measured), from ${date} on. Earlier puzzles keep their scores.`,
    "",
    "| word | fold | fix | score with the fold | score now | why the fold is wrong |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    ...(unmoved.length
      ? [
          `**Check these:** ${unmoved
            .map((w) => `\`${w}\``)
            .join(", ")} did not end up where the fix meant -- an exemption that raised ` +
            "no score, or a redirect that does not score as its base -- so the entry may be dead weight.",
          "",
        ]
      : []),
    ...(overturned.length
      ? [
          `<details><summary>${overturned.length} flagged but defended on re-review (left folding)</summary>`,
          "",
          "| word | fold | flag |",
          "| --- | --- | --- |",
          ...overturned.map(
            (r) =>
              `| \`${r.word}\` | ${(folds.get(r.word)?.path ?? "").split(">").join(" → ")} | ${cell(r.reason ?? "")} |`
          ),
          "",
          "</details>",
          "",
        ]
      : []),
    "Each exemption is a promotion -- the word scores rarer -- a redirect moves it to its " +
      "real base's score, and the judge disagrees with itself on roughly 7% of folds, so " +
      "read the table before merging.",
  ].join("\n");

  writeFileSync(`${OUT}/daily/pr-body.md`, body + "\n");
  stderr.write(
    `${redirected.size} redirected, ${applied.length - redirected.size} exempted, ` +
      `${unmoved.length} unmoved; wrote ${OUT}/daily/pr-body.md\n`
  );
}

main();
