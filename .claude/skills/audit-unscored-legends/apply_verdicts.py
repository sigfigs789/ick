#!/usr/bin/env python3
"""Apply the verdicts from an audit_unscored.py run: demote, reject, or keep.

Three verdicts, three mechanisms:

  --demote WORD=BASE   records a curated demotion in src/data/score-overrides.json,
                       so WORD scores no rarer than BASE from --date onward. The
                       word stays playable; only its score moves. Nothing else in
                       the data changes.
  --reject WORD=REASON records the word as unplayable in
                       src/data/word-rejections.json, with the reason a player
                       sees when they try it. The word stays in the dictionary.
  --keep WORD          no data change; records the word in reviewed.txt so the
                       next daily run does not re-surface it.

Both verdicts are one-line edits to a hand-maintained file, and both are dated, so
the assessment applies from the drop it was made for onward and no past puzzle
changes. Neither touches the generated data.

Rejecting by *removal* was the older approach and it lost information: five
index-aligned structures had to be edited in lockstep, the verdict ended up split
across blocklist.txt / rejection-metadata.json / wiktionary-reasons.json depending
on the reason, and a word's exclusion only survived a rebuild if it landed in
whichever of those files was regen-proof for that reason. Recording the verdict in
one never-regenerated file means each word is judged exactly once -- which is the
point: audit_unscored.py skips anything already listed instead of re-assessing it.

Dry run by default. Pass --apply to write.
"""
import argparse
import importlib.util
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo

    MOUNTAIN = ZoneInfo("America/Denver")
except Exception:  # pragma: no cover - no tzdata on host
    MOUNTAIN = timezone(timedelta(hours=-7))

# Reasons a reviewed rejection can carry, each mapped to the message submit.ts
# shows for it (REJECTION_MESSAGES there, CURATED_REJECTION_REASONS in
# dictionary.ts -- keep the three in step). "spurious" is a CLI alias for the
# generic message: a word with no more specific fault to name.
MESSAGES = {
    "misspelling": "This looks like a misspelling of another word.",
    "proper-noun": "This looks like a proper noun.",
    "abbreviation": "This looks like an abbreviation or acronym.",
    "name-or-abbreviation": "This looks like a proper noun or abbreviation.",
    "obsolete": "This looks archaic or obsolete.",
    "archaic": "This looks like an archaic word.",
    "dated": "This looks dated — no longer in common use.",
    "not-a-word": "That word is not in WordInk's curated list.",
}
ALIASES = {"spurious": "not-a-word"}
# Only "misspelling" implies there is a correctly spelled word to point at.
NEEDS_TARGET = {"misspelling"}
# Rejecting a word this common is a big enough call to require --force: at Zipf
# 2.5 and up the game already labels it Rare or better, i.e. a word people use.
COMMON_ZIPF = 2.5

WORD_RE = re.compile(r"^[a-z]+$")


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_pairs(items: list[str], flag: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in items:
        if "=" not in item:
            sys.exit(f"error: {flag} wants WORD=VALUE, got {item!r}")
        word, value = item.split("=", 1)
        out[word.strip().lower()] = value.strip().lower()
    return out


def dump_readable(path: Path, value) -> None:
    """Write hand-reviewed data indented and key-sorted, so a PR diff is legible."""
    path.write_text(json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n")


def derive_reason(word: str, base: str, audit) -> str:
    """A one-line note for the override entry, in the audit's own vocabulary."""
    for table, kind in ((audit.INFLECTIONAL, "inflection"), (audit.DERIVATIONAL, "suffix form")):
        for suffix, replacements in table:
            if not word.endswith(suffix) or len(word) <= len(suffix) + 2:
                continue
            stem = word[: -len(suffix)]
            if base in [stem + r for r in replacements] + [audit.strip_doubled(stem)]:
                shape = audit.SHAPE.get(suffix, f"-{suffix} {kind}")
                return f"{shape[0].upper()}{shape[1:]} of `{base}`; a suffix is not a discovery."
    for prefix in audit.PREFIXES:
        if word.startswith(prefix) and word[len(prefix) :] == base:
            return f"`{prefix}-` form of `{base}`; the prefix does not earn the rank."
    return f"Reviewed demotion to `{base}`."


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--repo", type=Path, default=Path.cwd(), help="ick checkout (default: cwd)")
    ap.add_argument("--demote", nargs="*", default=[], metavar="WORD=BASE")
    ap.add_argument(
        "--reject",
        nargs="*",
        default=[],
        metavar="WORD=REASON",
        help="REASON is one of " + ", ".join(sorted(set(MESSAGES) | set(ALIASES))) + "; "
        "misspelling takes the correct spelling, as in WORD=misspelling:CORRECTWORD",
    )
    ap.add_argument("--keep", nargs="*", default=[], metavar="WORD")
    ap.add_argument(
        "--date",
        help="puzzle date the demotions take effect from (default: tomorrow, Mountain Time). "
        "Past puzzles keep the scores they showed.",
    )
    ap.add_argument(
        "--seen",
        default=str(Path(__file__).resolve().parent / "reviewed.txt"),
        help="ledger every judged word is appended to; '' disables it",
    )
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    ap.add_argument("--force", action="store_true", help="proceed despite preflight warnings")
    ap.add_argument("--table", action="store_true", help="also print the PR-body verdict table")
    args = ap.parse_args()

    root: Path = args.repo.resolve()
    data = root / "src" / "data"
    scripts = root / "scripts"
    if not (data / "dictionary.json").exists():
        print(f"error: {root} is not an ick checkout", file=sys.stderr)
        return 2

    since = args.date or (datetime.now(MOUNTAIN).date() + timedelta(days=1)).isoformat()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", since):
        print(f"error: --date wants YYYY-MM-DD, got {since!r}", file=sys.stderr)
        return 2

    demotions = parse_pairs(args.demote, "--demote")
    rejections = parse_pairs(args.reject, "--reject")
    keeps = [w.strip().lower() for w in args.keep]
    if not (demotions or rejections or keeps):
        print("nothing to do; pass --demote, --reject and/or --keep", file=sys.stderr)
        return 2
    overlap = set(demotions) & set(rejections)
    if overlap:
        print(f"error: {', '.join(sorted(overlap))} is both demoted and rejected", file=sys.stderr)
        return 2

    sys.path.insert(0, str(scripts))
    audit = load_module(Path(__file__).resolve().parent / "audit_unscored.py", "audit_unscored")
    mew = load_module(scripts / "manage-extra-word.py", "manage_extra_word")

    dictionary: list[str] = json.loads((data / "dictionary.json").read_text())
    rarity = json.loads((data / "rarity.json").read_text())
    overrides = json.loads((data / "score-overrides.json").read_text())
    rejections_file = json.loads((data / "word-rejections.json").read_text())
    index = {w: i for i, w in enumerate(dictionary)}
    sentinel = min(rarity["zipfHundredths"])

    # The score each judged word shows *today*, read before anything is written so
    # the report's before/after column is measured rather than assumed.
    max_zipf = max(rarity["zipfHundredths"]) / 100

    def zipf_at(word: str) -> float:
        return rarity["zipfHundredths"][index[word]] / 100

    def current(word: str) -> tuple[str, str]:
        zipf = round(mew.adjusted_zipf(word, index, zipf_at), 2)
        score = mew.current_score(zipf, max_zipf)
        return mew.format_score(score), mew.rarity_label(zipf, max_zipf)

    before = {
        word: current(word)
        for word in list(demotions) + list(rejections) + keeps
        if word in index
    }

    # ---------------- preflight ----------------
    print(f"=== preflight ({len(demotions)} demote, {len(rejections)} reject, {len(keeps)} keep) ===")
    blocked = False

    # New scoring starts on the day of the drop and runs forward, never backwards.
    # A `since` earlier than today would re-score puzzles that have already been
    # played -- an archived result would stop matching the score its player saw,
    # which is the whole reason overrides are dated in the first place.
    today = datetime.now(MOUNTAIN).date().isoformat()
    if demotions:
        if since < today:
            print(
                f"  ERROR --date {since} is in the past; the demotions would re-score puzzles "
                f"already played. The drop day or later (>= {today})."
            )
            blocked = True
        elif since == today:
            print(
                f"  WARNING --date {since} is today, whose puzzle is live; a player mid-game would "
                "see a score change. Tomorrow's drop is the normal target."
            )

    for word in list(demotions) + list(rejections) + keeps:
        if not WORD_RE.fullmatch(word):
            print(f"  ERROR {word!r} is not a lowercase a-z word")
            blocked = True
        elif word not in index:
            print(f"  ERROR {word!r} is not in the dictionary")
            blocked = True

    for word, base in demotions.items():
        if word not in index or base not in index:
            if base not in index:
                print(f"  ERROR base {base!r} for {word!r} is not in the dictionary")
                blocked = True
            continue
        word_zipf = rarity["zipfHundredths"][index[word]]
        base_zipf = rarity["zipfHundredths"][index[base]]
        if base_zipf <= word_zipf:
            # Math.max() in adjustedZipf would ignore this, so it is a review
            # mistake rather than a harmless no-op.
            print(
                f"  ERROR {word!r} ({word_zipf / 100}) is not rarer than base {base!r} "
                f"({base_zipf / 100}); the override would do nothing"
            )
            blocked = True
        elif base in demotions:
            print(f"  ERROR base {base!r} is itself demoted; adjustedZipf folds one level only")
            blocked = True
        else:
            note = "" if word_zipf == sentinel else "  (word carries a real frequency)"
            print(f"  demote  {word:24s} -> {base} ({base_zipf / 100}) from {since}{note}")

    reject_reasons: dict[str, str] = {}
    reject_targets: dict[str, str] = {}
    for word, spec in rejections.items():
        raw, _, target = spec.partition(":")
        reason = ALIASES.get(raw, raw)
        if reason not in MESSAGES:
            print(
                f"  ERROR unknown reason {raw!r} for {word!r}; pick one of "
                f"{', '.join(sorted(set(MESSAGES) | set(ALIASES)))}"
            )
            blocked = True
            continue
        if reason in NEEDS_TARGET and not target:
            print(f"  ERROR {reason} for {word!r} needs a target, as in {word}={raw}:CORRECT")
            blocked = True
            continue
        if target and target not in index:
            # Not blocking: the player-facing message never names the target, so a
            # missing one costs nothing at play time, and the rejection itself is
            # still right. It does mean the correctly spelled word is unplayable,
            # which is worth following up separately.
            print(
                f"  WARNING correct spelling {target!r} for {word!r} is not itself playable; "
                "worth adding through the add-word flow"
            )
        reject_reasons[word] = reason
        reject_targets[word] = target
        if word in index:
            zipf = rarity["zipfHundredths"][index[word]] / 100
            note = ""
            if zipf >= COMMON_ZIPF:
                # Rejecting a word the corpora say people actually use is a much
                # bigger call than rejecting an unscored one.
                note = f"  ERROR attested at Zipf {zipf}, which the game labels Rare or better"
                blocked = True
            elif zipf != sentinel / 100:
                note = f"  (deep-tail attested at Zipf {zipf})"
            print(f"  reject  {word:24s} as {reason}{f' of {target}' if target else ''} from {since}{note}")

    # Reconcile against the audit: every word the run surfaced should carry a
    # verdict, and it is easy to drop one while hand-assembling the flags. Not a
    # refusal -- splitting a drop across two runs is legitimate, and the ledger
    # makes the leftovers reappear -- but it should never happen silently.
    judged_now = set(demotions) | set(rejections) | set(keeps)
    ledger = Path(args.seen) if args.seen else None
    already = (
        {w.strip() for w in ledger.read_text().split() if w.strip()}
        if ledger and ledger.exists()
        else set()
    )
    drops = json.loads((data / "drops.json").read_text())
    drop = audit.drop_for_date(since, drops).upper()
    candidates = {
        # Same ledger filtering the audit itself applies, so a word judged on an
        # earlier run is not reported as missing here.
        row["word"]
        for row in audit.build_report(root, drop, already, False)["words"]
    }
    unjudged = sorted(candidates - judged_now)
    if unjudged:
        print(
            f"\nWARNING {len(unjudged)} of {len(candidates)} unscored words for `{drop}` have no "
            f"verdict: {', '.join(unjudged)}"
        )
        print("  They stay at 10.00 and will resurface on the next run.")

    if blocked and not args.force:
        print("\nrefusing to proceed. Fix the errors above, or --force if deliberate.")
        return 1

    # ---------------- demotions ----------------
    for word, base in demotions.items():
        overrides[word] = {
            "base": base,
            "since": since,
            "reason": derive_reason(word, base, audit),
        }
    if demotions:
        print(f"\nscore-overrides.json -> {len(overrides)} entries (+{len(demotions)})")

    # ---------------- rejections ----------------
    for word, reason in reject_reasons.items():
        entry = {"reason": reason, "since": since}
        target = reject_targets.get(word)
        if target:
            entry["note"] = f"Misspelling of `{target}`."
        rejections_file[word] = entry
    if reject_reasons:
        print(f"\nword-rejections.json -> {len(rejections_file)} entries (+{len(reject_reasons)})")
        # A demotion that folds onto a rejected word would score it as something
        # nobody can play. Cheaper to catch here than in review.
        for word, override in overrides.items():
            if override["base"] in rejections_file:
                print(f"error: {word} folds onto rejected word {override['base']}", file=sys.stderr)
                return 2

    judged = sorted(set(demotions) | set(reject_reasons) | set(keeps))
    if ledger:
        print(f"\nreviewed.txt -> {len(already | set(judged))} words ({len(set(judged) - already)} new)")
        if args.apply:
            ledger.write_text("\n".join(sorted(already | set(judged))) + "\n")

    if not args.apply:
        print("\nDRY RUN -- nothing written. Re-run with --apply.")
    else:
        if demotions:
            dump_readable(data / "score-overrides.json", overrides)
        if reject_reasons:
            dump_readable(data / "word-rejections.json", rejections_file)
        print(
            f"\nwrote {len(demotions)} demotion(s) and {len(reject_reasons)} rejection(s); "
            f"the generated data is untouched ({len(dictionary):,} words, unchanged)"
        )
        print("now: npx vitest run && npx tsc -b && npx eslint .")

    if args.table:
        print("\n---\n")
        print("| word | current | verdict | new score | why |")
        print("| --- | --- | --- | --- | --- |")
        for word in judged:
            was = " ".join(before[word])
            if word in demotions:
                base = demotions[word]
                base_zipf = zipf_at(base)
                new = mew.format_score(mew.current_score(base_zipf, max_zipf))
                label = mew.rarity_label(base_zipf, max_zipf)
                print(
                    f"| `{word}` | {was} | demoted to `{base}` | **{new}** {label} "
                    f"| {overrides[word]['reason']} |"
                )
            elif word in reject_reasons:
                reason = reject_reasons[word]
                target = reject_targets.get(word)
                detail = MESSAGES[reason] + (f" (→ `{target}`)" if target else "")
                print(f"| `{word}` | {was} | rejected ({reason}) | unplayable | {detail} |")
            else:
                print(f"| `{word}` | {was} | **kept** | {was} | Earns the tier. |")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
