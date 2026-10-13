#!/usr/bin/env node
// Turn the verdicts on the fold review page into shipped scoring data.
//
//   node scripts/export-fold-rejections.mjs [--dry-run] [--since YYYY-MM-DD]
//
// The review page at /fold writes verdicts to Supabase (see api/fold-reviews.ts).
// A rejection there is a reviewed judgement, and it says one of two things:
//
//   * "it should fold to this instead" -- a recommended base, which scores the
//     word as that base the way src/data/score-overrides.json does.
//   * "it should not fold at all" -- no base, which leaves the word on its own
//     frequency the way src/data/fold-exemptions.json does.
//
// Both land in src/data/fold-review-verdicts.json, this page's own file, read by
// `reviewVerdictFor` in src/game/dictionary.ts. Its own file rather than a
// write into either curated table, because the two curated tables are written
// by hand an entry at a time and this one is written by a script out of a ledger
// of clicks. Same effect, different provenance -- and provenance is the first
// question anybody asks of a line in a scoring table. Kept apart, the answer is
// which file the word is in. The daily fold check also adds the bases its judge
// names there (see scripts/fold-audit/apply-daily.py); their reasons say so.
//
// A road rather than a wire, deliberately. Scoring is dated, deterministic and
// offline: a puzzle played today has to score the same when it is replayed from
// the archive next year, and a score that depended on a table somebody can edit
// mid-day could not promise that. So a verdict becomes data only when a person
// runs this, reads the diff, and ships it -- and each entry carries the date it
// shipped as `since`, which is what makes it apply from that puzzle onward and
// leaves every puzzle before it alone.
//
// Additive. An entry already in the file keeps its `since` and its reason: those
// are shipped facts about archived puzzles, and rewriting one would silently
// restate what an old puzzle scored. A word whose verdict has since changed --
// approved after being rejected, or pointed at a different base -- is reported
// rather than rewritten, because taking a shipped judgement back is a scoring
// change like any other.
//
// Credentials come from the environment, the same two the edge functions read:
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/export-fold-rejections.mjs
//
// There is no .env in this repo; the service-role key comes out of the Supabase
// CLI (`supabase projects api-keys --project-ref <ref>`).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "src", "data");
const VERDICTS = join(DATA, "fold-review-verdicts.json");
const EXEMPTIONS = join(DATA, "fold-exemptions.json");
const OVERRIDES = join(DATA, "score-overrides.json");
const DICTIONARY = join(DATA, "dictionary.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sinceFlag = args.indexOf("--since");
/**
 * The puzzle the new entries start at.
 *
 * Today by default, which is the honest answer for a change being shipped now:
 * an entry dated earlier would restate what an already-played puzzle scored.
 * `--since` is for the case where the deploy is known to land tomorrow.
 */
const since =
  sinceFlag >= 0 && args[sinceFlag + 1] ? args[sinceFlag + 1] : new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error(`--since wants a YYYY-MM-DD date, got ${since}`);
  process.exit(1);
}

const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
  process.exit(1);
}

const response = await fetch(`${url}/rest/v1/rpc/list_fold_reviews`, {
  method: "POST",
  headers: {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ p_limit: 10000 }),
});
if (!response.ok) {
  console.error(`list_fold_reviews ${response.status}: ${(await response.text()).slice(0, 300)}`);
  process.exit(1);
}
const reviews = await response.json();

const verdicts = JSON.parse(readFileSync(VERDICTS, "utf8"));
const exemptions = JSON.parse(readFileSync(EXEMPTIONS, "utf8"));
const overrides = JSON.parse(readFileSync(OVERRIDES, "utf8"));
const lexicon = new Set(JSON.parse(readFileSync(DICTIONARY, "utf8")));

const added = [];
const already = [];
/**
 * A word the curated tables already speak for. They are read first and win, so
 * an entry here would be dead data; and the disagreement is worth a person's
 * eye either way.
 */
const conflicts = [];
/** Shipped once, judged differently since: a scoring change this will not make. */
const changed = [];
/** A recommended base the dictionary does not have, which would be ignored. */
const unknown = [];

for (const review of reviews) {
  const { word, base, verdict, suggestedBase = null } = review;
  const shipped = verdicts[word];

  if (verdict === "approved") {
    // An approval says the fold as it stands is right, so there is nothing to
    // write. It only matters here if something was written for it before.
    if (shipped) changed.push(`${word}: shipped as ${describe(shipped.base)}, now approved`);
    continue;
  }
  if (verdict !== "rejected") continue;

  if (shipped) {
    if (shipped.base !== suggestedBase) {
      changed.push(
        `${word}: shipped as ${describe(shipped.base)}, now ${describe(suggestedBase)}`
      );
    } else {
      already.push(word);
    }
    continue;
  }
  if (exemptions[word] || overrides[word]) {
    conflicts.push(word);
    continue;
  }
  // A base the lexicon has never heard of is dropped by `overrideBase` at
  // scoring time, which would make the entry a quiet no-op. Reported instead.
  if (suggestedBase !== null && !lexicon.has(suggestedBase)) {
    unknown.push(`${word} -> ${suggestedBase}`);
    continue;
  }

  verdicts[word] = {
    base: suggestedBase,
    since,
    reason:
      suggestedBase === null
        ? `Reviewed on the fold page: scoring it as \`${base}\` was rejected, with no base recommended.`
        : `Reviewed on the fold page: scoring it as \`${base}\` was rejected in favour of \`${suggestedBase}\`.`,
  };
  added.push(`${word}: ${base} -> ${describe(suggestedBase)}`);
}

/** How an entry's base reads in a report line. */
function describe(base) {
  return base === null ? "no fold" : `\`${base}\``;
}

// Sorted, because the file is read by people looking a word up in it and a
// growing file in insertion order stops being lookup-able after the first pass.
const sorted = Object.fromEntries(Object.entries(verdicts).sort(([a], [b]) => (a < b ? -1 : 1)));

console.log(`${reviews.length} reviewed folds; ${added.length} new entries.`);
for (const line of added) console.log(`  + ${line}`);
if (already.length) console.log(`  ${already.length} already shipped, left as they are.`);
if (unknown.length) {
  console.log(`  ${unknown.length} recommend a base the dictionary does not have:`);
  for (const line of unknown) console.log(`    ! ${line}`);
}
if (conflicts.length) {
  console.log(`  ${conflicts.length} are already in a curated table, which wins -- resolve by hand:`);
  for (const word of conflicts) console.log(`    ! ${word}`);
}
if (changed.length) {
  console.log(`  ${changed.length} disagree with what is already shipped:`);
  for (const line of changed) console.log(`    ? ${line}`);
  console.log("    Changing a shipped judgement is a scoring change; do it deliberately.");
}

if (dryRun) {
  console.log("--dry-run: nothing written.");
} else if (added.length) {
  writeFileSync(VERDICTS, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`Wrote ${VERDICTS}. Read the diff, run the tests, ship it.`);
} else {
  console.log("Nothing to write.");
}
