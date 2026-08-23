#!/usr/bin/env python3
"""Triage the words a WordInk drop can reach that display a Mythic-or-better score
(>= 9.5) on a real measured frequency, and ask whether each one deserves the rank.

The sibling skill (audit-unscored-legends) owns the words no corpus attests at all,
which fall to rarity.json's sentinel and score a flat 10.00. This script owns the
rest of the same band and skips the sentinel words outright: what is left is the
words that *are* measured, just far out in the deep tail, where the wide-band curve
maps any Zipf under 1.0 into 9.9..10 no matter how ordinary the word underneath is.

    abandoner      Zipf 0.93 ->  9.91 Legend  while `abandon` sits at Zipf 4.02
    proportionates Zipf 0.42 ->  9.96 Legend  while `proportionate` sits at Zipf 3.04
    abaci          Zipf 1.19 ->  9.62 Mythic  while `abacus` sits at Zipf 2.65

A measured frequency is a measurement, so a rare word scoring rare is not a
finding. What *is* a finding is a word whose rank comes from something other than
being a rare word: an inflection the stemmer has no rule for, a suffix bolted onto
an ordinary base, a misspelling nothing counts because it is a misspelling, or a
word Wiktionary classifies archaic. Those four are the buckets below.

The last of those is a review signal only. A corpus label is not grounds to make a
word unplayable -- see SKILL.md 2a, and prefer demotion to rejection whenever the
word is a word.

Scope is one drop -- by default tomorrow's, Mountain Time, the same puzzle the
sibling audit defaults to. Even one drop reaches a few thousand words in this band,
so rows are ranked by how far the displayed score would fall if the word were
folded onto its base: the size of the overestimate as a player experiences it,
rather than as a Zipf delta.

Read-only. Loads src/data/*.json and reuses the scoring mirrors in
scripts/manage-extra-word.py plus the stemming, neighbour and family helpers in
the sibling skill, so every number here is what a player sees -- including
demotions and rejections recorded by earlier runs, which is why a word already
judged never comes back.

Usage (from the repo root, or with --repo):
    python3 demote_mythic_plus.py                      # tomorrow's drop, all buckets
    python3 demote_mythic_plus.py --bucket fold        # one bucket at a time
    python3 demote_mythic_plus.py --date 2026-08-19    # that puzzle's drop
    python3 demote_mythic_plus.py --drop ATE           # an arbitrary drop
    python3 demote_mythic_plus.py --limit 30 --json    # machine-readable
"""
import argparse
import bisect
import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo

    MOUNTAIN = ZoneInfo("America/Denver")
except Exception:  # pragma: no cover - no tzdata on host
    MOUNTAIN = timezone(timedelta(hours=-7))

SIBLING = Path(__file__).resolve().parent.parent / "audit-unscored-legends" / "audit_unscored.py"

# Mythic is the floor of the band this skill owns: MYTHIC_MIN_SCORE in
# src/game/dictionary.ts, mirrored in scripts/manage-extra-word.py.
DEFAULT_MIN_SCORE = 9.5
# A fold has to move the *displayed* score by this much to be worth an override
# entry. The sentinel audit measures its threshold in Zipf, which does not
# translate here: the deep tail compresses three Zipf points into the top 0.1 of
# the scale, so a 0.25 Zipf gap can be invisible at 9.9x and a 0.25 gap at Zipf
# 1.0 can be worth two whole points of score.
DEFAULT_MIN_DROP = 0.25
# Minimum Zipf gap for the fold to be meaningful at all, mirroring the sentinel
# audit's --min-gap so the two skills agree about what counts as "more common".
DEFAULT_MIN_GAP = 0.25
# A base this common is a warning sign, not a target. `-nesses` on `more`, `-est`
# on `even`, `-a` on `year`: when the base is a word everybody uses, a derived
# form no corpus counts is usually not a form of it at all but a different (or
# junk, or archaic) word, and capping it at the base's score would be as wrong as
# leaving it at 10.00. These are routed to `fold-suspect` for judgement instead of
# being proposed as demotions.
COMMON_BASE_ZIPF = 5.0
# Folding onto a three-letter base is how `hadal` becomes a form of `had` and
# `theer` a form of `the`. Spelling-only stripping gets less trustworthy the less
# of the word is left.
MIN_BASE_LEN = 4
# How much more common an attested near-spelling has to be before it reads as the
# correct spelling rather than an unrelated neighbour.
MISSPELLING_MIN_GAP = 1.0
# Wiktionary classifications the word rules exclude outright.
REJECT_CLASSES = ("obsolete", "archaic", "dated", "abbreviation", "proper-noun")


# Endings where the derived word is the same word in another number, tense or
# degree. Folding one of these onto its base is not a judgement call, so these are
# the demotions the run proposes outright. Drawn from the sibling skill's
# INFLECTIONAL table minus -er/-ers (which is two endings wearing one spelling:
# the comparative of `damp` is `damper`, but a `wiretapper` is not a form of
# `wiretap`) and minus the endings the game's own stemmer already folds.
FORM_SUFFIXES = [
    ("nesses", ["ness"]),
    ("ies", ["y"]),
    ("est", ["", "e"]),
    ("es", ["", "e", "is"]),
    ("s", [""]),
    ("ices", ["ex", "ix"]),
    ("ae", ["a"]),
    ("i", ["us"]),
    ("a", ["um", "on"]),
]

# Endings that build a new word on a base that is still plainly the same idea.
# Worth an override when the suffix is doing no work, but the base has to be
# eyeballed first -- `-ate` and `-ic` in particular land on unrelated words -- so
# these are reported for judgement rather than proposed.
JUDGE_SUFFIXES = [
    ("ers", ["", "e"]),
    ("er", ["", "e"]),
    ("ically", ["ic", "ical"]),
    ("ations", ["ate"]),
    ("ational", ["ation", "ate"]),
    ("isation", ["ise"]),
    ("ization", ["ize"]),
    ("ability", ["able"]),
    ("ibility", ["ible"]),
    ("ities", ["ity"]),
    ("ation", ["ate"]),
    ("ical", ["ic", "y"]),
    ("ally", ["al", "ic"]),
    ("ness", ["", "e"]),
    ("ists", ["e", ""]),
    ("isms", ["e", ""]),
    ("ist", ["e", ""]),
    ("ism", ["e", ""]),
    ("ity", ["e", ""]),
    ("ive", ["e", ""]),
    ("ous", ["e", ""]),
    ("ish", ["", "e"]),
    ("ful", [""]),
    ("less", [""]),
    ("ly", ["", "e"]),
    ("al", ["", "e", "um"]),
    ("ic", ["", "e", "y"]),
    ("ate", ["", "e"]),
]

# Review order. `classified` and `misspelling` first because they are rejections --
# a junk word left playable at a lower score is still a junk word accepted -- then
# the folds by how big the overestimate is.
BUCKETS = ("classified", "misspelling", "fold", "fold-suspect", "derivation")

BUCKET_BLURB = {
    "classified": "Wiktionary classifies it archaic, dated, obsolete, an abbreviation or a proper noun. A review signal, NOT a verdict -- the label is often wrong (`agminate` is current dermatology) and compound labels like \"archaic or literary\" are flattened on import. Reject only a word that is a *spelling* of another word; when in doubt keep it playable. See SKILL.md 2a.",
    "misspelling": "An attested near-spelling is materially more common. Reject as a misspelling if you can name the correct form; judge on the merits if the two are genuine variant spellings.",
    "fold": "Same word in another number, tense or degree, with a measured base that is materially more common. Demote to the base.",
    "fold-suspect": "The same, but onto a base everybody uses. The fold is usually still right (`evenest` really is the superlative of `even`), so check the *word* rather than the fold: this is where the classical-plural rule's misfires collect (`mosta`, `yeara`, `backa`) and where archaic forms hide (`whilest`, `madest`). Reject those; demote the rest.",
    "derivation": "A suffix form of a measured base. Demote when the suffix does no work; keep when it makes the word a genuinely rarer one -- `peopleless` is not `people` and `misrates` is not `rates`. Rows whose base is very common are ranked last here, because a big drop against a Zipf-6 base measures the fold's crudeness, not the word's rank.",
}


def load_derived_rejections(data) -> set:
    """Words the derived rejections (src/data/derived-rejections.json) put out of play.

    Same kind of settled verdict as word-rejections.json, read off Wiktionary's
    sense labels in bulk: the word keeps its dictionary entry and its rarity, so
    without this it would surface in every future run of this audit even though no
    player can submit it.
    """
    path = data / "derived-rejections.json"
    if not path.exists():
        return set()
    return {
        word
        for batch in json.loads(path.read_text()).values()
        for words in batch.values()
        for word in words
    }


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def listed_words(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {
        line.strip().lower()
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def build_report(
    root: Path,
    seen: set[str],
    drop: str,
    *,
    min_score: float = DEFAULT_MIN_SCORE,
    min_drop: float = DEFAULT_MIN_DROP,
    min_gap: float = DEFAULT_MIN_GAP,
    limit: int = 12,
    order: str = "magnitude",
    buckets: tuple[str, ...] = BUCKETS,
    include_all: bool = False,
) -> dict:
    scripts = root / "scripts"
    sys.path.insert(0, str(scripts))
    if not SIBLING.exists():
        sys.exit(f"error: sibling helper {SIBLING} is missing; this skill reuses its stemmer")
    sib = load_module(SIBLING, "audit_unscored")
    mew = load_module(scripts / "manage-extra-word.py", "manage_extra_word")

    data = root / "src" / "data"
    dictionary: list[str] = json.loads((data / "dictionary.json").read_text())
    hundredths = json.loads((data / "rarity.json").read_text())["zipfHundredths"]
    # Settled verdicts. Rejected words keep their dictionary entry and their
    # rarity, so without this they would surface in every future run.
    rejected = set(json.loads((data / "word-rejections.json").read_text()))
    rejected |= load_derived_rejections(data)
    overrides = json.loads((data / "score-overrides.json").read_text())
    index = {w: i for i, w in enumerate(dictionary)}
    sentinel = min(hundredths) / 100
    max_zipf = max(hundredths) / 100

    def zipf_at(word: str) -> float:
        return hundredths[index[word]] / 100

    def scored(word: str) -> dict:
        zipf = round(mew.adjusted_zipf(word, index, zipf_at), 2)
        score = mew.current_score(zipf, max_zipf)
        return {
            "zipf": zipf,
            "score": round(score, 2),
            "display": mew.format_score(score),
            "label": mew.rarity_label(zipf, max_zipf),
        }

    def score_for_zipf(zipf: float) -> dict:
        score = mew.current_score(zipf, max_zipf)
        return {
            "zipf": zipf,
            "score": round(score, 2),
            "display": mew.format_score(score),
            "label": mew.rarity_label(zipf, max_zipf),
        }

    attested = {
        w: hundredths[i] / 100 for i, w in enumerate(dictionary) if hundredths[i] / 100 > sentinel
    }
    reasons: dict[str, str] = {}
    for reason, words in json.loads((scripts / "wiktionary-reasons.json").read_text()).items():
        for word in words:
            reasons.setdefault(word, reason)
    provenance = {
        name: listed_words(scripts / name)
        for name in ("wiktionary-accepted.txt", "extra-words.txt", "online-words.txt", "suggested-words.txt")
    }

    # Only what a player can actually reach on this puzzle. A word outside the
    # drop is not this run's problem however wrong its rank looks.
    needle = drop.lower()
    pool = [w for w in dictionary if needle in w]

    def best_fold(word: str, zipf: float, table) -> tuple[str, str, float] | None:
        """Nearest base in `table` that is measured and materially more common.

        Nearest, not deepest: `cocultivates` folds to `cocultivate`, never straight
        to `cultivate`. Bases that are themselves unattested are skipped rather
        than returned -- the cap reads the base's raw Zipf, so folding onto one
        would leave the word exactly where it is.
        """
        for base, suffix in sib.suffix_bases(word, table, index):
            base_zipf = zipf_at(base)
            if base_zipf > sentinel and base_zipf - zipf >= min_gap and len(base) >= MIN_BASE_LEN:
                return base, suffix, base_zipf
        return None

    counts = {name: 0 for name in BUCKETS}
    counts["deserves-it"] = 0
    unscored = 0
    rows: list[dict] = []
    band_total = 0
    skipped_seen = 0

    for word in pool:
        if word in rejected:
            continue
        info = scored(word)
        if info["score"] < min_score:
            continue
        if info["zipf"] == sentinel:
            # No corpus attests it, so its 10.00 comes from rarity.json's sentinel
            # rather than from a measurement. That is audit-unscored-legends'
            # territory, and it wants different evidence -- this skill would only
            # duplicate its verdicts.
            unscored += 1
            continue
        band_total += 1
        if word in seen and not include_all:
            skipped_seen += 1
            continue

        zipf = info["zipf"]
        classification = reasons.get(word)
        bucket: str | None = None
        fold: tuple[str, str, float] | None = None
        variant: tuple[str, float] | None = None

        if classification in REJECT_CLASSES:
            bucket = "classified"
        else:
            # A near-spelling check before the folds: a misspelled plural should be
            # rejected as a misspelling, not demoted onto the misspelled singular.
            for near in sib.neighbours(word, index, attested):
                if sib.spelling_variant(word, near) and attested[near] - zipf >= MISSPELLING_MIN_GAP:
                    variant = (near, attested[near])
                    break
            if variant is not None:
                bucket = "misspelling"
            else:
                fold = best_fold(word, zipf, FORM_SUFFIXES)
                if fold is not None:
                    bucket = "fold-suspect" if fold[2] >= COMMON_BASE_ZIPF else "fold"
                else:
                    fold = best_fold(word, zipf, JUDGE_SUFFIXES)
                    bucket = "derivation" if fold is not None else None

        if bucket is None:
            # Nothing mechanical explains the rank: a rare word scoring rare. This
            # is what the tier is supposed to be made of, and it is not reported.
            counts["deserves-it"] += 1
            continue

        folded = score_for_zipf(fold[2]) if fold else None
        # The overestimate as a player would feel it. Rejections have no fold, so
        # they are ranked by how high they sit -- an archaic word at 10.00 is worse
        # than one at 9.51.
        magnitude = round(info["score"] - folded["score"], 2) if folded else round(info["score"], 2)
        if folded is not None and magnitude < min_drop:
            # Below this the word and its base display near enough the same score
            # that a player would not notice, so an override entry would buy
            # nothing. Same reasoning as the sentinel audit's --min-gap.
            counts["deserves-it"] += 1
            continue

        counts[bucket] += 1
        rows.append(
            {
                "word": word,
                "bucket": bucket,
                "magnitude": magnitude,
                # Whether the proposed base is a word everybody uses. Ranked last
                # inside the derivation bucket: `-less` on `people` produces a huge
                # nominal drop and a wrong demotion.
                "suspect_base": bool(fold and fold[2] >= COMMON_BASE_ZIPF),
                "unattested": zipf == sentinel,
                "classified": classification,
                **{f"now_{k}": v for k, v in info.items()},
                **(
                    {
                        "base": fold[0],
                        "shape": sib.SHAPE.get(fold[1], f"-{fold[1]} form"),
                        "suffix": fold[1],
                        **{f"folded_{k}": v for k, v in folded.items()},
                    }
                    if fold
                    else {}
                ),
                **({"variant": variant[0], "variant_zipf": variant[1]} if variant else {}),
            }
        )

    # Review order, then worst overestimate first -- except that a suspect base
    # sinks to the end of its bucket. `peopleless` shows a 7.7-point drop against
    # `people` and `abandoner` a 5.0-point drop against `abandon`; only the second
    # is a real overestimate, and ranking on magnitude alone puts the first on top.
    # `magnitude` is the displayed points at stake: a fold's drop, or -- for a row
    # with no fold, i.e. a rejection candidate -- the whole current score. Those
    # are comparable as "how wrong is this score", so ranking on it across buckets
    # puts the real overestimates first regardless of which bucket they landed in.
    # Two guards survive the change: a suspect base still sinks (`peopleless` shows
    # a 7.7-point drop against `people` and is not an overestimate at all), and the
    # bucket index only breaks ties, so review order is preserved among equals.
    rows.sort(key=lambda r: (r["suspect_base"], -r["magnitude"], BUCKETS.index(r["bucket"]), r["word"]))
    if order == "bucket":
        # Per-bucket batching: review order first, capped per bucket so one huge
        # bucket cannot crowd out the others.
        rows.sort(key=lambda r: (BUCKETS.index(r["bucket"]), r["suspect_base"], -r["magnitude"], r["word"]))
        batch: list[dict] = []
        for name in buckets:
            batch.extend([r for r in rows if r["bucket"] == name][:limit])
    else:
        # Worst-first batching: one global cut at the top of the ranking. The
        # per-bucket cap is what let a 10.00 misspelling sit unreviewed while an
        # alphabetically-earlier tie took its slot, so the cap becomes a total.
        batch = [r for r in rows if r["bucket"] in buckets][: limit * max(1, len(buckets))]

    def family_of(word: str) -> list[str]:
        """The word's dictionary siblings, same output as the sibling skill's
        family() but found by bisecting the sorted dictionary rather than scanning
        it. The scan is 225k comparisons per word, which is fine for one drop's
        worth of candidates and not fine for a batch drawn from the whole band.
        """
        stem = word
        for table in (FORM_SUFFIXES, JUDGE_SUFFIXES):
            found = sib.suffix_bases(stem, table, index)
            if found:
                stem = found[0][0]
                break
        root = stem[:-1] if len(stem) > 6 else stem
        if len(root) < 5:
            return []
        start = bisect.bisect_left(dictionary, root)
        out = []
        for candidate in dictionary[start : start + 64]:
            if not candidate.startswith(root):
                break
            if candidate != word:
                out.append(candidate)
        return out

    # The rest of the evidence -- sibling words, prefixed bases, which accept list
    # the word came in on -- only for the rows actually being reviewed. Enriching
    # all ~21k findings instead of the batch is pure waste, since only the batch is
    # ever printed.
    for row in batch:
        word = row["word"]
        row["prefixes"] = [
            {"base": base, "shape": shape, **{f"base_{k}": v for k, v in scored(base).items()}}
            for base, shape in sib.prefix_bases(word, index)[:3]
        ]
        row["family"] = family_of(word)[:6]
        row["lists"] = [name for name, words in provenance.items() if word in words]

    return {
        "drop": drop,
        "min_score": min_score,
        "min_drop": min_drop,
        "band_total": band_total,
        "unscored": unscored,
        "skipped_seen": skipped_seen,
        "overrides": len(overrides),
        "rejected": len(rejected),
        "counts": counts,
        "reported": batch,
        "findings": len(rows),
    }


def render(report: dict, buckets: tuple[str, ...]) -> None:
    print(
        f"=== drop `{report['drop']}`: {report['band_total']:,} attested words score "
        f"{report['min_score']}+ ({report['skipped_seen']:,} already judged) ==="
    )
    print(
        f"    {report['unscored']:,} unscored words in the band skipped -- "
        "they belong to audit-unscored-legends"
    )
    counts = report["counts"]
    print(f"    reporting folds that move the displayed score by >= {report['min_drop']} points")
    print(
        f"    {counts['deserves-it']:,} deserve it (nothing mechanical explains the rank) | "
        f"{report['findings']:,} findings: "
        + " | ".join(f"{counts[name]:,} {name}" for name in BUCKETS)
    )
    print(
        f"    already settled: {report['overrides']} demotions, {report['rejected']} rejections\n"
    )

    for name in buckets:
        rows = [r for r in report["reported"] if r["bucket"] == name]
        if not rows:
            continue
        print(f"--- {name} ({counts[name]:,} found, showing {len(rows)}) ---")
        print(f"    {BUCKET_BLURB[name]}\n")
        for row in rows:
            tag = " [unattested]" if row["unattested"] else ""
            print(f"  {row['word']}  {row['now_display']} {row['now_label']} (Zipf {row['now_zipf']}){tag}")
            if row.get("base"):
                warn = "  <- base is very common; check the fold, not just the word" if row["suspect_base"] else ""
                print(
                    f"      fold -> {row['base']} (Zipf {row['folded_zipf']}) "
                    f"= {row['folded_display']} {row['folded_label']}   "
                    f"-{row['magnitude']} points   {row['shape']}{warn}"
                )
            if row.get("variant"):
                print(
                    f"      near-spelling: {row['variant']} (Zipf {row['variant_zipf']}) "
                    f"-- name it as the correct form or judge them variant spellings"
                )
            if row.get("classified"):
                print(f"      Wiktionary: {row['classified']}")
            for pre in row["prefixes"]:
                print(
                    f"      prefixed base: {pre['base']} ({pre['shape']}) "
                    f"= {pre['base_display']} {pre['base_label']}"
                )
            if row["family"]:
                print(f"      family: {', '.join(row['family'])}")
            if row["lists"]:
                print(f"      from: {', '.join(row['lists'])}")
            print()


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--repo", type=Path, default=Path.cwd(), help="ick checkout (default: cwd)")
    ap.add_argument("--drop", help="audit this drop instead of the one --date resolves to")
    ap.add_argument("--date", help="puzzle date whose drop to audit (default: tomorrow, Mountain Time)")
    ap.add_argument(
        "--min-score",
        type=float,
        default=DEFAULT_MIN_SCORE,
        help=f"displayed-score floor for the band (default {DEFAULT_MIN_SCORE}, i.e. Mythic)",
    )
    ap.add_argument(
        "--min-drop",
        type=float,
        default=DEFAULT_MIN_DROP,
        help=f"displayed points a fold must move to be reported (default {DEFAULT_MIN_DROP})",
    )
    ap.add_argument("--min-gap", type=float, default=DEFAULT_MIN_GAP, help="Zipf gap a base must clear")
    ap.add_argument(
        "--limit",
        type=int,
        default=12,
        help="rows per bucket, or per bucket-equivalent of the global cut (default 12)",
    )
    ap.add_argument(
        "--order",
        choices=("magnitude", "bucket"),
        default="magnitude",
        help="magnitude (default): worst overestimate first across all buckets. "
        "bucket: review order, capped per bucket (the pre-2026-08-20 behaviour)",
    )
    ap.add_argument(
        "--bucket",
        action="append",
        choices=BUCKETS,
        help="only this bucket; repeatable (default: all, in review order)",
    )
    ap.add_argument(
        "--seen",
        default=str(Path(__file__).resolve().parent / "reviewed.txt"),
        help="ledger of words already judged; '' disables it",
    )
    ap.add_argument("--all", action="store_true", help="ignore the ledger")
    ap.add_argument(
        "--candidates-out",
        type=Path,
        help="write the reported words here, one per line, for apply_verdicts.py --candidates",
    )
    ap.add_argument("--json", action="store_true", help="full diagnostics as JSON")
    args = ap.parse_args()

    root: Path = args.repo.resolve()
    if not (root / "src" / "data" / "dictionary.json").exists():
        print(f"error: {root} is not an ick checkout", file=sys.stderr)
        return 2

    if args.drop and args.date:
        print("error: pass --drop or --date, not both", file=sys.stderr)
        return 2
    if args.drop:
        drop = args.drop.upper()
    else:
        # Same default as the sibling skill: tomorrow's puzzle, Mountain Time, so
        # the two audits review the same drop on the same day and any demotion is
        # dated to a puzzle nobody has played yet.
        date = args.date or (datetime.now(MOUNTAIN).date() + timedelta(days=1)).isoformat()
        drops = json.loads((root / "src" / "data" / "drops.json").read_text())
        sib = load_module(SIBLING, "audit_unscored")
        drop = sib.drop_for_date(date, drops).upper()

    ledger = Path(args.seen) if args.seen else None
    seen = (
        {w.strip() for w in ledger.read_text().split() if w.strip()}
        if ledger and ledger.exists()
        else set()
    )
    buckets = tuple(args.bucket) if args.bucket else BUCKETS

    report = build_report(
        root,
        seen,
        drop=drop,
        min_score=args.min_score,
        min_drop=args.min_drop,
        min_gap=args.min_gap,
        limit=args.limit,
        order=args.order,
        buckets=buckets,
        include_all=args.all,
    )

    if args.candidates_out:
        args.candidates_out.write_text(
            "\n".join(sorted(r["word"] for r in report["reported"])) + "\n"
        )

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        render(report, buckets)
        if report["findings"] > len(report["reported"]):
            print(
                f"{report['findings'] - len(report['reported']):,} more findings not shown. "
                "Judge this batch, record the verdicts, and re-run -- the ledger keeps the "
                "next run from repeating it."
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
