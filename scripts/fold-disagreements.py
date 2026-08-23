#!/usr/bin/env python3
"""Compare the scoring folds against MorphyNet and report where they disagree.

The folds in src/game/stem.ts decide a word's base from its *spelling*: strip a
known affix, keep the candidates the dictionary attests, take the most common.
That is the right shape for a rule that has to run in the browser off a flat
word list, and it is deliberately silent on the derivations spelling cannot
settle -- "battlement" is not a form of "battle", and no suffix rule can tell
that from "government".

MorphyNet is the other half of that: a Wiktionary-derived table of
`base -> derived` edges, inflectional and derivational, prefixes included. It
knows nothing about frequency, playability, or the measurement floor, so it can
never replace the rules. What it can do is disagree with them, and each kind of
disagreement points at a different thing to fix:

  MISSING   MorphyNet folds, we don't.  Usually a derivational suffix the rules
            decline to guess at. Since the 2026-08-24 cutover a prefix row means
            something narrower than "no rule strips prefixes": either a
            fossilised prefix deliberately excluded (de-/re-/co-/dis-) or a base
            below PREFIX_BASE_MIN_ZIPF. The largest bucket and the noisiest,
            since MorphyNet will derive words the WordInk rules reject outright.
  SUSPECT   We fold, MorphyNet doesn't.  A spelling coincidence the dictionary
            check let through; candidate for fold-exemptions.json. Empty over
            the Mythic band on the first run, and low-precision over the full
            dictionary (most rows are correct folds like "allness" -> "all"
            that Wiktionary simply does not record), so read it for the odd
            real catch -- "daylily" -> "day" -- not as a list of defects.
  DIVERGENT Both fold, to different words.  Historically the highest-signal
            bucket: it is what showed that nothing stripped prefixes, so a word
            dead-ended on an unattested prefixed stem while its root sat one
            strip further. That rule shipped on 2026-08-24, and what is left is
            mostly the suffix families -- "-ally" is the largest -- plus the
            fossilised prefixes the rule declines on purpose. "codriver" ->
            "codrive" still appears here for exactly that reason, and is not a
            bug. Candidate for score-overrides.json, or for the next rule.

Both sides answer the same question -- "the most common dictionary word
reachable by folding" -- so the comparison is like-for-like: chained_base()
explores spelling candidates, walk_morphynet() explores MorphyNet edges, and
both return the highest-Zipf word they reach.

This is an offline triage aid, not a source of truth. MorphyNet is descriptive:
it happily derives words the WordInk word rules reject outright, and it inherits
Wiktionary's coverage bias, so an absent edge is not evidence of anything. Every
row here needs a human verdict, exactly like the audit skills' output.

Usage:
    python3 scripts/fold-disagreements.py --morphynet-dir DIR [options]

The MorphyNet TSVs are not vendored (8MB + 25MB). Fetch them once with:
    curl -sSLO https://raw.githubusercontent.com/kbatsuren/MorphyNet/main/eng/eng.derivational.v1.tsv
    curl -sSLO https://raw.githubusercontent.com/kbatsuren/MorphyNet/main/eng/eng.inflectional.v1.tsv
"""
import argparse
import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DICTIONARY_PATH = ROOT / "src" / "data" / "dictionary.json"
RARITY_PATH = ROOT / "src" / "data" / "rarity.json"

# Reuse the fold mirror rather than re-implementing it: manage-extra-word.py is
# already kept in lockstep with src/game/stem.ts, so a disagreement this script
# reports is a disagreement with the shipped rules and not with a third copy.
# The hyphenated filename is not importable as a module name.
_spec = importlib.util.spec_from_file_location("mew", ROOT / "scripts" / "manage-extra-word.py")
mew = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mew)

# Minimum length of a base MorphyNet is allowed to propose, by edge kind --
# the same floors stem.ts applies to its own candidates. Without them the walk
# lands on the short function words whose corpus frequency is collected from
# every word containing them, and every row in the report becomes a fold onto
# "in", "be", "do" or "up".
MIN_BASE_LEN = {"infl": 3, "deriv": 4}


def load_morphynet(directory: Path) -> tuple[dict[str, list[tuple[str, str, str]]], set[str]]:
    """`(derived -> [(base, affix-label, kind)], every word MorphyNet mentions)`.

    Derivational rows are `base, derived, base_pos, derived_pos, affix, kind`;
    inflectional rows are `base, inflected, features, segmentation`. Only the
    direction matters here, so both collapse to the same edge map.

    Rows are filtered to lowercase a-z: MorphyNet carries proper nouns and
    hyphenated forms that the WordInk dictionary would never hold anyway, and
    keeping them only adds edges that can never fire.
    """
    edges: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    # Every word appearing on either side of either file. MorphyNet having no
    # base for a word it has never heard of is ignorance, not disagreement, and
    # the SUSPECT bucket needs to tell those apart.
    known: set[str] = set()

    derivational = directory / "eng.derivational.v1.tsv"
    inflectional = directory / "eng.inflectional.v1.tsv"
    for path in (derivational, inflectional):
        if not path.exists():
            sys.exit(f"Missing {path}. See the module docstring for the curl commands.")

    with derivational.open() as handle:
        for line in handle:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 6:
                continue
            base, derived, _, _, affix, kind = parts[:6]
            if not (base.isalpha() and derived.isalpha() and base.islower() and derived.islower()):
                continue
            label = f"{affix}-" if kind == "prefix" else f"-{affix}"
            edges[derived].append((base, label, "deriv"))
            known.update((base, derived))

    with inflectional.open() as handle:
        for line in handle:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            base, derived, features = parts[0], parts[1], parts[2]
            if not (base.isalpha() and derived.isalpha() and base.islower() and derived.islower()):
                continue
            edges[derived].append((base, features.split(";")[0], "infl"))
            known.update((base, derived))

    return edges, known


def walk_morphynet(
    word: str,
    edges: dict[str, list[tuple[str, str, str]]],
    index: dict[str, int],
    zipf_at,
    depth: int,
) -> tuple[str, float, str] | None:
    """The most common dictionary word reachable from `word` along MorphyNet edges.

    Breadth-first, every branch explored, returning the highest-Zipf dictionary
    word found -- the same question chained_base() answers, so the two are
    comparable. The walk passes *through* non-dictionary words, so a chain can
    cross a gap the way "materialnesses" crosses its unattested middle, but only
    a dictionary member can be the answer.

    `depth` defaults to 1 for a reason. MorphyNet's derivational edges are
    etymological rather than compositional, and chaining them collapses onto
    whatever homograph of a function word sits at the bottom: at depth 8 this
    reported "chadless" -> "have", "centiare" -> "are" (the unit of area, scored
    as the copula) and some 60 words folding onto "do". One hop is also the
    question actually being asked -- is this word some other word plus an affix
    -- and the multi-hop chaining is already stem.ts's job.

    Returns (base, zipf, affix label) or None.
    """
    seen = {word}
    frontier = [(word, None)]
    best: tuple[str, float, str] | None = None
    for _ in range(depth):
        if not frontier:
            break
        nxt: list[tuple[str, str | None]] = []
        for current, origin_label in frontier:
            for base, label, kind in edges.get(current, ()):
                if base in seen:
                    continue
                seen.add(base)
                first_label = origin_label or label
                nxt.append((base, first_label))
                if base not in index or len(base) < MIN_BASE_LEN[kind]:
                    continue
                zipf = zipf_at(base)
                if best is None or zipf > best[1]:
                    best = (base, zipf, first_label)
        frontier = nxt
    return best


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--morphynet-dir",
        type=Path,
        required=True,
        help="Directory holding eng.derivational.v1.tsv and eng.inflectional.v1.tsv",
    )
    parser.add_argument(
        "--out",
        type=Path,
        help="Write the markdown report here (default: stdout)",
    )
    parser.add_argument(
        "--min-delta",
        type=float,
        default=0.5,
        help="Only report a disagreement that moves the displayed score by at least "
        "this much (default: 0.5, a third of a rarity band)",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=60,
        help="Rows to show per bucket (default: 60)",
    )
    parser.add_argument(
        "--depth",
        type=int,
        default=1,
        help="How many MorphyNet hops to walk (default: 1; see walk_morphynet for "
        "why chaining etymological edges goes wrong)",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        help="Also write every row (not just --top) as CSV, for feeding the audit skills",
    )
    parser.add_argument(
        "--mythic-only",
        action="store_true",
        help="Restrict to words currently scoring Mythic or better (9.5+), the band "
        "the audit skills own",
    )
    args = parser.parse_args()

    dictionary = json.loads(DICTIONARY_PATH.read_text())
    rarity = json.loads(RARITY_PATH.read_text())
    hundredths = rarity["zipfHundredths"]
    index = {w: i for i, w in enumerate(dictionary)}
    max_zipf = max(hundredths) / 100

    def zipf_at(w: str) -> float:
        return hundredths[index[w]] / 100

    def score_of(zipf: float) -> float:
        return mew.current_score(round(zipf, 2), max_zipf)

    reviewed = set(mew.load_score_overrides()) | set(mew.load_fold_exemptions())

    print(f"Loading MorphyNet from {args.morphynet_dir}...", file=sys.stderr)
    edges, known = load_morphynet(args.morphynet_dir)
    print(f"  {len(edges):,} words with at least one base edge", file=sys.stderr)

    missing: list[dict] = []
    suspect: list[dict] = []
    divergent: list[dict] = []
    skipped_reviewed = 0
    agreed = 0

    for i, word in enumerate(dictionary):
        if i % 20000 == 0:
            print(f"  {i:,}/{len(dictionary):,}", file=sys.stderr)
        own = zipf_at(word)
        own_score = score_of(own)
        if args.mythic_only:
            # The word's *current* displayed score, folds included -- that is what
            # a player sees and what the audit skills triage.
            current = score_of(mew.adjusted_zipf(word, index, zipf_at))
            if current < mew.MYTHIC_MIN_SCORE:
                continue

        ours = mew.chained_base(word, index, zipf_at)
        theirs = walk_morphynet(word, edges, index, zipf_at, args.depth)

        if ours is None and theirs is None:
            continue
        # Reviewed first, so `agreed` and `skipped_reviewed` describe the same
        # population. Checking agreement first counted a reviewed word whose
        # override happens to match MorphyNet as agreement while excluding its
        # disagreeing neighbours, quietly inflating the header figure the two
        # runs are compared on.
        if word in reviewed:
            skipped_reviewed += 1
            continue
        if ours is not None and theirs is not None and ours[0] == theirs[0]:
            agreed += 1
            continue

        if ours is None and theirs is not None:
            delta = own_score - score_of(theirs[1])
            if delta < args.min_delta:
                continue
            missing.append(
                {
                    "word": word,
                    "delta": delta,
                    "from": own_score,
                    "to": score_of(theirs[1]),
                    "base": theirs[0],
                    "note": theirs[2],
                }
            )
        elif ours is not None and theirs is None:
            # Silence only counts as disagreement if MorphyNet has heard of the
            # word. Ungated, this bucket was 62 rows of *correct* plural folds
            # ("agallochs" -> "agalloch") that MorphyNet simply does not carry,
            # every one reading a flat 0.50 -- absence of an edge is absence of
            # coverage far more often than it is evidence of a bad fold.
            if word not in known:
                continue
            delta = own_score - score_of(ours[1])
            if delta < args.min_delta:
                continue
            suspect.append(
                {
                    "word": word,
                    "delta": delta,
                    "from": own_score,
                    "to": score_of(ours[1]),
                    "base": ours[0],
                    "note": "no MorphyNet edge",
                }
            )
        else:
            delta = abs(score_of(ours[1]) - score_of(theirs[1]))
            if delta < args.min_delta:
                continue
            divergent.append(
                {
                    "word": word,
                    "delta": delta,
                    "from": score_of(ours[1]),
                    "to": score_of(theirs[1]),
                    "base": f"{ours[0]} vs {theirs[0]}",
                    "note": theirs[2],
                }
            )

    for bucket in (missing, suspect, divergent):
        bucket.sort(key=lambda row: -row["delta"])

    out: list[str] = []
    w = out.append
    scope = "Mythic-or-better words only" if args.mythic_only else "the full dictionary"
    w("# Fold disagreements: WordInk rules vs MorphyNet\n")
    w(
        f"Scope: {scope} ({len(dictionary):,} words). Only disagreements moving the "
        f"displayed score by ≥ {args.min_delta} are listed. "
        f"{agreed:,} words fold to the same base on both sides; {skipped_reviewed:,} "
        "disagreements are already covered by score-overrides.json or "
        "fold-exemptions.json and were skipped.\n"
    )
    w(
        "MorphyNet is descriptive, not playability-aware, and its coverage is "
        "Wiktionary's. Every row needs a human verdict.\n"
    )

    # (title, blurb, rows, left-column header, right-column header). The columns
    # are named per bucket because they do not mean the same thing in each: for
    # MISSING and DIVERGENT the left column is what the game displays today and
    # the right is hypothetical, but a SUSPECT word already folds, so the right
    # column is the live score and the left is what removing the fold restores.
    # A single "our score | would be" header read exactly backwards there.
    sections = [
        (
            "MISSING — MorphyNet folds, we don't",
            "A base the rules never offered. The derivational rows are the point of "
            "the exercise: suffixes stem.ts declines to guess at, which a table can "
            "settle. The right column is the score the word would get if the fold "
            "were adopted.",
            missing,
            "scores today",
            "would score",
        ),
        (
            "SUSPECT — we fold, MorphyNet doesn't",
            "A spelling coincidence the dictionary check let through, or a real "
            "derivation Wiktionary happens not to record. Note the columns are the "
            "other way round here: the word already folds, so the right column is "
            "what players see today and the left is what dropping the fold would "
            "restore. A large delta is a large unearned demotion. Candidates for "
            "fold-exemptions.json.",
            suspect,
            "without the fold",
            "scores today",
        ),
        (
            "DIVERGENT — both fold, different base",
            "Usually the frequency ranking preferring a lookalike to the real base. "
            "The left column is our base's score, the right MorphyNet's. "
            "Candidates for score-overrides.json.",
            divergent,
            "scores today",
            "would score",
        ),
    ]
    for title, blurb, rows, left, right in sections:
        w(f"\n## {title} ({len(rows):,})\n")
        w(f"{blurb}\n")
        if not rows:
            w("_None._\n")
            continue
        w(f"| word | {left} | {right} | Δ | base | affix |")
        w("| --- | --- | --- | --- | --- | --- |")
        for row in rows[: args.top]:
            w(
                f"| {row['word']} | {row['from']:.2f} | {row['to']:.2f} | "
                f"{row['delta']:.2f} | {row['base']} | {row['note']} |"
            )
        if len(rows) > args.top:
            w(f"\n_{len(rows) - args.top:,} more rows not shown (raise `--top`)._\n")

    if args.csv:
        import csv as _csv

        with args.csv.open("w", newline="") as handle:
            writer = _csv.writer(handle)
            writer.writerow(["bucket", "word", "our_score", "would_be", "delta", "base", "affix"])
            for bucket, rows in (("missing", missing), ("suspect", suspect), ("divergent", divergent)):
                for row in rows:
                    writer.writerow(
                        [
                            bucket,
                            row["word"],
                            f"{row['from']:.2f}",
                            f"{row['to']:.2f}",
                            f"{row['delta']:.2f}",
                            row["base"],
                            row["note"],
                        ]
                    )
        print(f"Wrote {args.csv}", file=sys.stderr)

    report = "\n".join(out) + "\n"
    if args.out:
        args.out.write_text(report)
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(report)


if __name__ == "__main__":
    main()
