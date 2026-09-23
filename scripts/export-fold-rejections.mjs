#!/usr/bin/env node
// Turn the rejections on the fold review page into fold exemptions.
//
//   node scripts/export-fold-rejections.mjs [--dry-run] [--since YYYY-MM-DD]
//
// The review page at /fold writes verdicts to Supabase (see api/fold-reviews.ts).
// A rejection there is a reviewed judgement -- "this word should not be scored
// as that one" -- and the file that actually stops a fold in the game is
// src/data/fold-exemptions.json, which is bundled, dated and read by
// `foldExempt` in src/game/dictionary.ts. This is the one road between them.
//
// A road rather than a wire, deliberately. Scoring is dated, deterministic and
// offline: a puzzle played today has to score the same when it is replayed from
// the archive next year, and a score that depended on a table somebody can edit
// mid-day could not promise that. So a rejection becomes an exemption only when
// a person runs this, reads the diff, and ships it -- and the exemption carries
// the date it shipped as `since`, which is what makes it apply from that puzzle
// onward and leaves every puzzle before it alone.
//
// Additive. An entry already in the file keeps its `since` and its reason: those
// are shipped facts about archived puzzles, and rewriting one would silently
// restate what an old puzzle scored. A word that has since been approved is left
// alone too -- taking an exemption back is a scoring change like any other, and
// this script will report it rather than make it.
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
const EXEMPTIONS = join(HERE, "..", "src", "data", "fold-exemptions.json");
const OVERRIDES = join(HERE, "..", "src", "data", "score-overrides.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sinceFlag = args.indexOf("--since");
/**
 * The puzzle the new exemptions start at.
 *
 * Today by default, which is the honest answer for a change being shipped now:
 * an exemption dated earlier would restate what an already-played puzzle scored.
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

const exemptions = JSON.parse(readFileSync(EXEMPTIONS, "utf8"));
const overrides = JSON.parse(readFileSync(OVERRIDES, "utf8"));

const added = [];
const already = [];
/**
 * A word carrying both an exemption and an override. The exemption would win
 * silently, and a test in dictionary.test.ts holds the two files apart -- so
 * this reports the collision and writes nothing for that word rather than
 * producing a tree that fails its own tests.
 */
const conflicts = [];
/** Rejected once, approved later: a scoring change this script will not make. */
const reversed = [];

for (const review of reviews) {
  const { word, base, verdict } = review;
  if (verdict === "approved") {
    if (exemptions[word]) reversed.push(word);
    continue;
  }
  if (verdict !== "rejected") continue;
  if (exemptions[word]) {
    already.push(word);
    continue;
  }
  if (overrides[word]) {
    conflicts.push(word);
    continue;
  }
  exemptions[word] = {
    since,
    reason: `Reviewed on the fold page: scoring it as \`${base}\` was rejected by hand.`,
  };
  added.push(`${word} -> ${base}`);
}

// Sorted, because the file is read by people looking a word up in it and a
// growing file in insertion order stops being lookup-able after the first pass.
const sorted = Object.fromEntries(Object.entries(exemptions).sort(([a], [b]) => (a < b ? -1 : 1)));

console.log(`${reviews.length} reviewed folds; ${added.length} new exemptions.`);
for (const line of added) console.log(`  + ${line}`);
if (already.length) console.log(`  ${already.length} already exempt, left as they are.`);
if (conflicts.length) {
  console.log(`  ${conflicts.length} also carry a score override -- resolve by hand:`);
  for (const word of conflicts) console.log(`    ! ${word}`);
}
if (reversed.length) {
  console.log(`  ${reversed.length} approved on the page but still exempt in the file:`);
  for (const word of reversed) console.log(`    ? ${word}`);
  console.log("    Taking an exemption back is a scoring change; do it deliberately.");
}

if (dryRun) {
  console.log("--dry-run: nothing written.");
} else if (added.length) {
  writeFileSync(EXEMPTIONS, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`Wrote ${EXEMPTIONS}. Read the diff, run the tests, ship it.`);
} else {
  console.log("Nothing to write.");
}
