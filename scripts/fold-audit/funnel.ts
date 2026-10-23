/**
 * Where the 1,217,270 corpus headwords go.
 *
 * The judgeable population is not the headword count, and the gap is worth
 * being able to print rather than assert: a word the game will not accept has
 * no fold to be wrong about, and a fold that does not move the score cannot
 * cost a player anything, because a fold is a cap.
 */
import { readFileSync } from "node:fs";
import { loadCorpus } from "../../src/game/corpus";
import { foldTrace, rarityScore, scoringReady } from "../../src/game/dictionary";
import { setMode } from "../../src/game/mode";
import { evaluateSubmission } from "../../src/game/submit";

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

async function main(): Promise<void> {
  setMode("standard");
  serve();
  await loadCorpus();
  await scoringReady();
  const DATE = "2026-10-01";

  const words = corpusWords();
  let unplayable = 0;
  let noFold = 0;
  let freeFold = 0;
  let costlyFold = 0;

  for (const word of words) {
    if (!evaluateSubmission(word, "", [], DATE).ok) {
      unplayable++;
      continue;
    }
    const trace = foldTrace(word, DATE);
    if (!trace) {
      noFold++;
      continue;
    }
    const delta = rarityScore(trace.ownZipf, DATE) - rarityScore(trace.baseZipf, DATE);
    if (delta < 0.005) freeFold++;
    else costlyFold++;
  }

  const pct = (n: number) => `${((100 * n) / words.length).toFixed(1)}%`;
  console.log(`corpus headwords                 ${words.length}`);
  console.log(`  not playable at all            ${unplayable}  ${pct(unplayable)}`);
  console.log(`  playable, folds nowhere        ${noFold}  ${pct(noFold)}`);
  console.log(`  folds, but score does not move ${freeFold}  ${pct(freeFold)}`);
  console.log(`  folds AND loses points         ${costlyFold}  ${pct(costlyFold)}   <- the judgeable set`);
}

main();
