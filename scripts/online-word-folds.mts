/**
 * Score the rare words "Find rare words found online" turned up, the way
 * Standard will once they play: which base word each one should score as, and
 * for a word no frequency corpus measures, Claude's guess at its Zipf.
 *
 *   prepare  runs every word through the game's own fold (`foldTrace`, in
 *            Standard) and writes Claude's request: confirm or correct the base
 *            the rules picked, and estimate a Zipf for each unattested word.
 *   report   prices the base Claude settled on and writes the Markdown table:
 *            the word, the folded word, the original display score, the folded
 *            display score and, when unattested, Claude's estimate.
 *
 *   ./node_modules/.bin/vite-node scripts/online-word-folds.mts -- prepare \
 *     --words .tmp/online.json --out .tmp/folds.json --request .tmp/request.md --answer .tmp/answer.json
 *   ./node_modules/.bin/vite-node scripts/online-word-folds.mts -- report \
 *     --folds .tmp/folds.json --answer .tmp/answer.json --out .tmp/report.md
 *
 * `--words` is find-online-words.py's --json-out. Read-only: nothing here
 * changes the game's data.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// The corpus loads over fetch in the browser; serve public/ off disk instead.
globalThis.fetch = (async (input: string | URL) => {
  const path = String(input).split("?")[0].replace(/^\//, "");
  const body = readFileSync(resolve(root, "public", path));
  return new Response(body);
}) as typeof fetch;

const { loadCorpus, corpusEntry } = await import("../src/game/corpus.ts");
const { asMode } = await import("../src/game/mode.ts");
const { foldTrace, formatRarityScore, rarityFor, rarityForUncurated, rarityForZipf, unattestedZipf } =
  await import("../src/game/dictionary.ts");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function need(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`missing --${name}; see the usage at the top of scripts/online-word-folds.mts`);
    process.exit(2);
  }
  return value;
}

if (!(await loadCorpus())) {
  console.error("could not load public/corpus");
  process.exit(1);
}

const sentinel = unattestedZipf();

/** A word's own frequency, unfolded: the curated list, then the corpus, then the finder's waterfall. */
function ownZipf(word: string, date: string, measured: number | null): number {
  const curated = rarityFor(word, date, "freeform");
  if (curated) return curated.zipf;
  const corpus = corpusEntry(word);
  if (corpus) return corpus.zipf ?? sentinel;
  return measured ?? sentinel;
}

/**
 * What a base scores as in Standard -- its own fold applied, as the chain reads
 * every link -- or undefined when no lexicon knows it, so it cannot be priced.
 */
function priceBase(word: string, date: string): number | undefined {
  return asMode("standard", () => {
    const curated = rarityFor(word, date);
    if (curated) return curated.zipf;
    const corpus = corpusEntry(word);
    if (!corpus) return undefined;
    return rarityForUncurated(word, corpus.zipf ?? sentinel, date).zipf;
  });
}

interface Fold {
  word: string;
  ownZipf: number;
  unattested: boolean;
  /** The base the rules fold onto, or null when nothing folds. */
  ruleBase: string | null;
  ruleZipf: number | null;
  rulePath: string | null;
}

interface FoldsFile {
  date: string;
  drop: string;
  folds: Fold[];
}

const REQUEST = `\
You are reviewing rare words for WordInk, a daily word game. Players type words \
that contain the day's letter "drop", and each word scores by how rare it is, on \
the Zipf scale: log10 of a word's frequency per billion words of running text. \
For reference: 7 "the"; 5 "people"; 4 "elephant"; 3 "camaraderie"; 2 \
"obsequious"; 1 "sesquipedalian"; 0 "achalasias" (in dictionaries, almost never \
seen in text).

In the default mode, Standard, a word that is a mechanical form of another -- an \
inflection, a plural, an -ly/-ness/-er/un-/re- derivation -- scores as that more \
common base word ("uncreatively" scores as "creative"), never as a longer word. \
The game's fold rules have proposed a base for some of the words below. They \
misfire on words whose apparent stem is a different word ("rehearse" is not \
"hearse", "scowly" is not "scow").

For every word below:
1. \`base\`: the word it should score as. Keep the rules' base when it is right; \
give a better base when the rules picked the wrong one or missed one; give the \
word itself when it should not fold at all. A base must be shorter than or as \
long as the word, and a real English word.
2. \`zipf\`: only for words marked UNATTESTED (no frequency corpus measures them): \
your estimate of the word's own Zipf in a large, current corpus of general \
English, with two decimals. Most such words belong between -1.5 and 1; a recent \
coinage in wide use can be higher. Leave it out for every other word.
3. \`reason\`: one sentence, at most 25 words, a reviewer can check.

Write your answer to \`{answer}\` as JSON and nothing else, in this shape:

{"words": [{"word": "uncreatively", "base": "creative", "reason": "Adverb of uncreative, a transparent un- form of creative."}, \
{"word": "chatchkes", "base": "chatchke", "zipf": 0.12, "reason": "Plural of a rare variant spelling of tchotchke."}]}

One entry per word, spelled exactly as given. Work from what you know; look a \
word up on the web only when you cannot place it at all. Do not edit any other \
file.

The words, drop {drop}, puzzle {date}:
`;

function prepare(): void {
  const input = JSON.parse(readFileSync(need("words"), "utf8")) as {
    date: string;
    drop: string;
    words: { word: string; zipf: number | null }[];
  };
  const { date, drop } = input;
  const folds: Fold[] = input.words.map(({ word, zipf }) => {
    const own = ownZipf(word, date, zipf);
    const trace = asMode("standard", () => foldTrace(word, date, own));
    return {
      word,
      ownZipf: own,
      unattested: own === sentinel,
      ruleBase: trace?.base ?? null,
      ruleZipf: trace?.baseZipf ?? null,
      rulePath: trace ? [word, ...trace.path.map((hop) => hop.to)].join(" > ") : null,
    };
  });
  const file: FoldsFile = { date, drop, folds };
  writeFileSync(need("out"), JSON.stringify(file, null, 2) + "\n");

  const lines = folds.map((f) => {
    const rule = f.ruleBase ? `rules fold it: ${f.rulePath}` : "rules: no fold";
    return `- ${f.word}${f.unattested ? " (UNATTESTED)" : ` (Zipf ${f.ownZipf.toFixed(2)})`} -- ${rule}`;
  });
  const request =
    REQUEST.replace("{answer}", need("answer")).replace("{drop}", drop.toUpperCase()).replace("{date}", date) +
    "\n" +
    lines.join("\n") +
    "\n";
  writeFileSync(need("request"), request);
  const unattested = folds.filter((f) => f.unattested).length;
  const folded = folds.filter((f) => f.ruleBase).length;
  console.log(`${date} ${drop}: ${folds.length} word(s), ${folded} folded by the rules, ${unattested} unattested`);
}

interface Answer {
  base?: string;
  zipf?: number;
  reason?: string;
}

function readAnswers(path: string): Map<string, Answer> {
  const answers = new Map<string, Answer>();
  if (!existsSync(path)) return answers;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { words?: unknown };
    for (const entry of Array.isArray(raw.words) ? raw.words : []) {
      if (!entry || typeof entry.word !== "string") continue;
      const base = typeof entry.base === "string" && /^[a-z]+$/.test(entry.base.trim().toLowerCase())
        ? entry.base.trim().toLowerCase()
        : undefined;
      const zipf = typeof entry.zipf === "number" && Number.isFinite(entry.zipf) ? entry.zipf : undefined;
      const reason = typeof entry.reason === "string" ? entry.reason : undefined;
      answers.set(entry.word.trim().toLowerCase(), { base, zipf, reason });
    }
  } catch {
    console.error(`could not read ${path}; reporting the rules' folds alone`);
  }
  return answers;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function shown(zipf: number, date: string): string {
  return `${formatRarityScore(zipf, date)} ${rarityForZipf(zipf, date, "standard")}`;
}

function report(): void {
  const { date, drop, folds } = JSON.parse(readFileSync(need("folds"), "utf8")) as FoldsFile;
  const answers = readAnswers(need("answer"));

  const rows: string[] = [];
  let changed = 0;
  let disagreed = 0;
  let estimated = 0;
  for (const f of folds) {
    const answer = answers.get(f.word);
    const estimate = f.unattested ? answer?.zipf : undefined;
    if (estimate !== undefined) estimated++;
    // The word's own Zipf as Standard will see it: Claude's guess stands in for
    // the sentinel, as an estimated-zipf.json batch would.
    const own = estimate ?? f.ownZipf;

    // Claude has the last word on the base; the rules' pick stands when it
    // gave none, or named one longer than the word, which Standard never uses.
    let base = f.ruleBase ?? f.word;
    let baseZipf = f.ruleZipf ?? own;
    const notes: string[] = [];
    const pick = answer?.base;
    if (pick && pick.length <= f.word.length && pick !== base) {
      disagreed++;
      if (pick === f.word) {
        base = f.word;
        baseZipf = own;
        notes.push(f.ruleBase ? `Claude: no fold (rules: ${f.ruleBase})` : "");
      } else {
        const priced = priceBase(pick, date);
        if (priced === undefined) {
          notes.push(`Claude suggested ${pick}, which no lexicon knows; kept ${base}`);
        } else {
          notes.push(`Claude: ${pick} (rules: ${f.ruleBase ?? "no fold"})`);
          base = pick;
          baseZipf = priced;
        }
      }
    }
    if (!answer) notes.push("no answer from Claude");
    else if (answer.reason) notes.push(answer.reason);

    // A fold is a cap: it only ever makes a word more common.
    const foldedZipf = Math.max(own, baseZipf);
    if (base !== f.word && foldedZipf > own) changed++;
    rows.push(
      [
        f.word,
        base === f.word ? "—" : base,
        shown(f.ownZipf, date),
        shown(foldedZipf, date),
        f.unattested ? (estimate === undefined ? "no estimate" : `Zipf ${estimate.toFixed(2)} → ${shown(estimate, date)}`) : "",
        notes.filter(Boolean).join(" · "),
      ]
        .map(cell)
        .join(" | ")
    );
  }

  const unattested = folds.filter((f) => f.unattested).length;
  const out = [
    `## Rare online words for the \`${drop.toUpperCase()}\` drop (${date})`,
    "",
    folds.length === 0
      ? "Datamuse turned up no new rare words for this drop."
      : `${folds.length} word(s): ${changed} score as a more common base in Standard, ` +
        `${disagreed} where Claude overruled the fold rules, ` +
        `${estimated} of ${unattested} unattested word(s) estimated by Claude.`,
    "",
    "Original score is the word's own frequency (Freeform). Folded score is what Standard shows " +
      "once the word folds onto its base, with Claude's estimate standing in for an unattested word's own Zipf.",
    "",
  ];
  if (rows.length > 0) {
    out.push(
      "| Word | Folded word | Original score | Folded score | Claude estimate (unattested) | Notes |",
      "| --- | --- | --- | --- | --- | --- |",
      ...rows.map((row) => `| ${row} |`)
    );
  }
  writeFileSync(need("out"), out.join("\n") + "\n");
  console.log(out.slice(0, 3).join("\n"));
}

const command = process.argv.find((a) => a === "prepare" || a === "report");
if (command === "prepare") prepare();
else if (command === "report") report();
else {
  console.error("usage: online-word-folds.mts -- prepare|report ...");
  process.exit(2);
}
