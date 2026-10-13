/**
 * Price the base the daily fold check's judge named for each confirmed wrong
 * fold, so apply-daily.py can tell a redirect from an exemption.
 *
 *   npx vite-node scripts/fold-audit/price-bases.ts -- 2026-10-08
 *
 * Reads scripts/fold-audit/out/daily/confirmed.tsv and writes
 * scripts/fold-audit/out/daily/bases.tsv, `word	base	baseZipf`. A word whose
 * judge named no base, or named one the lexicon lacks or no corpus measures,
 * gets an empty `baseZipf` and is exempted rather than redirected: a base priced
 * at the unattested sentinel would score the word a 10.00 it never earned.
 *
 * Off the TS engine with the corpus loaded, like dump-folds.ts, because most
 * bases since CORPUS_ONLY_START are corpus-only and Python cannot price them.
 */

// @ts-expect-error -- Node builtins; this app has no @types/node, but vite-node
// runs under Node. Same dodge as dump-folds.ts.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
// @ts-expect-error -- as above.
import { argv, stderr } from "node:process";

import { loadCorpus } from "../../src/game/corpus";
import { measuredBaseZipf } from "../../src/game/dictionary";
import { setMode } from "../../src/game/mode";

const OUT = "scripts/fold-audit/out/daily";

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

/** A tab-separated file with a header row, as records. As in daily-report.ts. */
function readTsv(path: string): Record<string, string>[] {
  if (!existsSync(path)) return [];
  const [header, ...lines] = readFileSync(path, "utf8").split("\n").filter((l: string) => l.trim());
  const keys = header.split("\t");
  return lines.map((line: string) => {
    const cells = line.split("\t");
    return Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? "").trim()]));
  });
}

async function main(): Promise<void> {
  const date = argv.slice(2).find((a: string) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (!date) {
    stderr.write("usage: vite-node price-bases.ts -- YYYY-MM-DD\n");
    return;
  }

  setMode("standard");
  serveShippedCorpus();
  if (!(await loadCorpus())) throw new Error("corpus failed to load");

  const rows = ["word\tbase\tbaseZipf"];
  let priced = 0;
  for (const row of readTsv(`${OUT}/confirmed.tsv`)) {
    const word = row.word.toLowerCase();
    // "-" and "" both mean the judge named no base.
    const base = /^[a-z]+$/.test(row.base?.toLowerCase() ?? "") ? row.base.toLowerCase() : "";
    const zipf = base && base !== word ? measuredBaseZipf(base, date) : undefined;
    if (zipf !== undefined) priced++;
    rows.push([word, base, zipf === undefined ? "" : zipf.toFixed(2)].join("\t"));
  }

  writeFileSync(`${OUT}/bases.tsv`, rows.join("\n") + "\n");
  stderr.write(`${rows.length - 1} confirmed, ${priced} with a measured base; wrote ${OUT}/bases.tsv\n`);
}

main();
