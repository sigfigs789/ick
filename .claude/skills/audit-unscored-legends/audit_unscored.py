#!/usr/bin/env python3
"""Triage the words a WordInk drop can reach that score a perfect 10.0 / Legend
purely because no frequency corpus attests them.

A word wordfreq, Norvig and Google Books all miss falls to rarity.json's
unattested sentinel, which scores the very top of the scale. That is the right
answer for a genuine find the corpora have not caught up with
("enshittification") and the wrong answer for a mechanical derivation of an
ordinary word ("iratest", the superlative of a Zipf-2.78 word). This script finds
the second kind and hands the reviewer the evidence to tell them apart:

  * the base word each candidate derives from, nearest derivation first, with the
    score the candidate *would* get if it were folded onto that base
  * attested near-spellings, the tell for a misspelling that only scores 10.0
    because nothing attests the typo
  * the rest of the word's family, so a whole typo family is removed together
  * where the word entered the dictionary, and any archaic/dated/obsolete
    classification Wiktionary recorded for it

Read-only. Loads src/data/*.json and reuses the scoring mirrors in
scripts/manage-extra-word.py, so every number here is what a player sees --
including any demotion already recorded in src/data/score-overrides.json, which
is why an already-demoted word never comes back in a later run.

Usage (from the repo root, or with --repo):
    python3 audit_unscored.py                  # tomorrow's drop, Mountain Time
    python3 audit_unscored.py --date 2026-08-19
    python3 audit_unscored.py --drop ATE
    python3 audit_unscored.py --all --json     # every unscored word, machine-readable
"""
import argparse
import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Mountain Time = UTC-7 (MDT) / UTC-6 (MST). zoneinfo is used when available so
# the DST boundary is exact; the fixed -7 fallback only matters on hosts with no
# tz database.
try:
    from zoneinfo import ZoneInfo

    MOUNTAIN = ZoneInfo("America/Denver")
except Exception:  # pragma: no cover - no tzdata on host
    MOUNTAIN = timezone(timedelta(hours=-7))

ALPHABET = "abcdefghijklmnopqrstuvwxyz"

# Inflectional endings: the same word in another number/tense/degree. Folding one
# of these onto its base is never a judgement call -- a plural is not a rarer word
# than its singular -- so these are the demotions the run proposes outright.
# (suffix, replacements to try for the stripped stem). Longest first: the first
# ending that yields a dictionary word is the nearest base.
INFLECTIONAL = [
    ("nesses", ["ness"]),
    ("ings", ["", "e"]),
    ("ers", ["", "e"]),
    ("ies", ["y"]),
    ("est", ["", "e"]),
    ("ing", ["", "e"]),
    ("ed", ["", "e"]),
    ("es", ["", "e", "is"]),
    ("er", ["", "e"]),
    ("s", [""]),
    # Classical plurals, invisible to any spelling-only stemmer.
    ("ices", ["ex", "ix"]),
    ("ae", ["a"]),
    ("i", ["us"]),
    ("a", ["um", "on"]),
]

# Derivational endings: a new part of speech built on a base that is still plainly
# the same idea ("placation" from "placate"). Also a demotion -- adding a suffix
# is not a discovery -- but the base is worth eyeballing, because a spelling-only
# strip can land on an unrelated word ("laterizes" -> "later").
DERIVATIONAL = [
    ("ically", ["ic", "ical"]),
    ("ations", ["ate"]),
    ("ational", ["ation", "ate"]),
    ("isation", ["ise"]),
    ("ization", ["ize"]),
    ("ability", ["able"]),
    ("ibility", ["ible"]),
    ("ities", ["ity"]),
    ("ation", ["ate"]),
    ("ically", ["ic"]),
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
    # Last, because -ate is the most overloaded ending in the list (verb-forming
    # "activate", chemical "sulfate", office/territory "emirate"). Kept because it
    # is also self-limiting: across all 1,976 unscored words it proposes exactly
    # two bases, "nizamate" -> "nizam" and "emeerate" -> "emeer", both right.
    ("ate", ["", "e"]),
]

# Productive prefixes. A prefixed form is a *different* word from its base, and
# often genuinely rarer, so these are reported for judgement and never proposed as
# a demotion on their own. Longest first so "counter-" wins over "co-".
PREFIXES = [
    "pseudo",
    "counter",
    "hyper",
    "inter",
    "intra",
    "multi",
    "quasi",
    "super",
    "trans",
    "ultra",
    "under",
    "anti",
    "over",
    "semi",
    "mis",
    "non",
    "out",
    "pre",
    "pro",
    "sub",
    "dis",
    "co",
    "de",
    "ex",
    "re",
    "un",
]

# How a demotion reads in the PR table, per ending.
SHAPE = {
    "s": "plural / third-person form",
    "es": "plural / third-person form",
    "ies": "plural form",
    "nesses": "plural of an -ness noun",
    "er": "comparative or agent noun",
    "ers": "plural agent noun",
    "est": "superlative",
    "ing": "gerund",
    "ings": "plural gerund",
    "ed": "past-tense form",
    "ices": "classical plural",
    "ae": "classical plural",
    "i": "classical plural",
    "a": "classical plural",
    "ation": "-ation noun",
    "ations": "plural -ation noun",
    "ational": "-ational adjective",
    "ness": "-ness noun",
    "ly": "adverb form",
    "al": "-al adjective",
    "ally": "-ally adverb",
    "ic": "-ic adjective",
    "ical": "-ical adjective",
    "ically": "-ically adverb",
    "ism": "-ism noun",
    "ist": "-ist noun",
    "ity": "-ity noun",
    "ive": "-ive adjective",
    "ous": "-ous adjective",
    "ish": "-ish adjective",
    "ful": "-ful adjective",
    "less": "-less adjective",
    "isation": "-isation noun",
    "ization": "-ization noun",
    "ability": "-ability noun",
    "ibility": "-ibility noun",
}

ACCEPT_LISTS = [
    "wiktionary-accepted.txt",
    "extra-words.txt",
    "online-words.txt",
    "suggested-words.txt",
]


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def drop_for_date(date_str: str, drops: dict) -> str:
    epoch = datetime.strptime(drops["epoch"], "%Y-%m-%d").date()
    day = datetime.strptime(date_str, "%Y-%m-%d").date()
    words = drops["drops"]
    return words[(day - epoch).days % len(words)]


def listed_words(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {
        line.strip().lower()
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def strip_doubled(stem: str) -> str:
    if len(stem) > 3 and stem[-1] == stem[-2] and stem[-1] in "bcdfghjklmnpqrstvwxyz":
        return stem[:-1]
    return stem


def suffix_bases(word: str, table, index) -> list[tuple[str, str]]:
    """(base, suffix) for every ending in `table` that yields a dictionary word.

    Table order is significant: the first hit is the nearest derivation, i.e. the
    fewest steps from the word the player typed.
    """
    out: list[tuple[str, str]] = []
    for suffix, replacements in table:
        if not word.endswith(suffix) or len(word) <= len(suffix) + 2:
            continue
        stem = word[: -len(suffix)]
        for candidate in [stem + r for r in replacements] + [strip_doubled(stem)]:
            if candidate and candidate != word and candidate in index:
                pair = (candidate, suffix)
                if pair not in out:
                    out.append(pair)
    return out


def prefix_bases(word: str, index) -> list[tuple[str, str]]:
    """(base, prefix) for every productive prefix whose remainder is a real word.

    Also tried with one inflectional ending stripped, so "overoperates" reports
    "operate" and not only "operates".
    """
    out: list[tuple[str, str]] = []
    for prefix in PREFIXES:
        if not word.startswith(prefix) or len(word) - len(prefix) < 4:
            continue
        rest = word[len(prefix) :]
        candidates = [(rest, prefix)] if rest in index else []
        for base, suffix in suffix_bases(rest, INFLECTIONAL, index):
            candidates.append((base, f"{prefix}- -{suffix}"))
        for pair in candidates:
            if pair not in out:
                out.append(pair)
    return out


def neighbours(word: str, index, attested) -> list[str]:
    """Dictionary words one edit away from `word` that carry a real frequency.

    An attested near-spelling is the misspelling tell: "reaccomodates" scores 10.0
    only because nothing attests the typo, while its correctly spelled sibling is
    measured. Covers deletion, substitution, insertion and transposition, which
    between them catch the doubled/dropped letter and -ise/-ize cases.
    """
    variants = set()
    for i in range(len(word)):
        variants.add(word[:i] + word[i + 1 :])
        for c in ALPHABET:
            variants.add(word[:i] + c + word[i + 1 :])
            variants.add(word[:i] + c + word[i:])
        if i + 1 < len(word):
            variants.add(word[:i] + word[i + 1] + word[i] + word[i + 2 :])
    variants.update(word + c for c in ALPHABET)
    variants.discard(word)
    return sorted(
        (v for v in variants if v in index and v in attested),
        key=lambda v: -attested[v],
    )


VOWELS = "aeiouy"


def spelling_variant(a: str, b: str) -> bool:
    """Whether `a` and `b` are two spellings of one word rather than two words.

    Any two words one edit apart look alike ("misrate"/"migrate"), and treating
    every such pair as a misspelling floods the report. The pairs that actually
    matter have one of three shapes:

      * a doubled consonant on one side ("accomodate"/"accommodate")
      * an -ise/-ize style s/z swap ("laterise"/"laterize")
      * a single swapped vowel ("exhilirative"/"exhilarative")

    Everything else is two different words that happen to be neighbours.
    """
    if abs(len(a) - len(b)) > 1 or a == b:
        return False
    if len(a) != len(b):
        longer, shorter = (a, b) if len(a) > len(b) else (b, a)
        # The longer spelling must be the shorter one with a letter doubled.
        for i in range(len(longer)):
            if longer[:i] + longer[i + 1 :] != shorter:
                continue
            neighbours_of_i = longer[max(i - 1, 0) : i] + longer[i + 1 : i + 2]
            if longer[i] in neighbours_of_i:
                return True
        return False
    differing = [i for i in range(len(a)) if a[i] != b[i]]
    if len(differing) != 1:
        return False
    pair = {a[differing[0]], b[differing[0]]}
    return pair == {"s", "z"} or pair <= set(VOWELS)


def family(word: str, index) -> list[str]:
    """Other dictionary words built on the same stem.

    A typo family ("reassimiliate/-d/-s/-ing") has to be removed whole or not at
    all, so the reviewer needs to see the siblings before deciding.
    """
    stem = word
    for table in (INFLECTIONAL, DERIVATIONAL):
        found = suffix_bases(stem, table, index)
        if found:
            stem = found[0][0]
            break
    root = stem[:-1] if len(stem) > 6 else stem
    if len(root) < 5:
        return []
    return [w for w in index if w != word and w.startswith(root)][:12]


def build_report(root: Path, drop: str, seen: set[str], include_all: bool) -> dict:
    scripts = root / "scripts"
    sys.path.insert(0, str(scripts))
    mew = load_module(scripts / "manage-extra-word.py", "manage_extra_word")

    dictionary = json.loads((root / "src" / "data" / "dictionary.json").read_text())
    hundredths = json.loads((root / "src" / "data" / "rarity.json").read_text())["zipfHundredths"]
    # Words already judged unplayable. They stay in dictionary.json (the rejection
    # is recorded, not carved out of the generated data), so they would otherwise
    # show up in every future run of this drop -- and re-assessing a settled
    # verdict is exactly what the rejections file exists to prevent.
    rejected = set(json.loads((root / "src" / "data" / "word-rejections.json").read_text()))
    index = {w: i for i, w in enumerate(dictionary)}
    sentinel = min(hundredths) / 100
    max_zipf = max(hundredths) / 100

    def zipf_at(word: str) -> float:
        return hundredths[index[word]] / 100

    # Words carrying a real measured frequency, for the neighbour search.
    attested = {w: hundredths[i] / 100 for i, w in enumerate(dictionary) if hundredths[i] / 100 > sentinel}

    def scored(word: str) -> dict:
        zipf = round(mew.adjusted_zipf(word, index, zipf_at), 2)
        score = mew.current_score(zipf, max_zipf)
        return {
            "zipf": zipf,
            "score": round(score, 2),
            "display": mew.format_score(score),
            "label": mew.rarity_label(zipf, max_zipf),
        }

    reasons = {}
    grouped = json.loads((scripts / "wiktionary-reasons.json").read_text())
    for reason, words in grouped.items():
        for word in words:
            reasons.setdefault(word, reason)
    provenance = {name: listed_words(scripts / name) for name in ACCEPT_LISTS}

    needle = drop.lower()
    matches = [w for w in dictionary if needle in w and w not in rejected]
    rows = []
    for word in matches:
        info = scored(word)
        # Only words whose *post-adjustment* Zipf is still the sentinel: anything
        # the existing folds (or an override recorded by an earlier run) already
        # rescued scores on real data and is not this audit's problem.
        if info["zipf"] != sentinel:
            continue
        if word in seen and not include_all:
            continue

        inflectional = suffix_bases(word, INFLECTIONAL, index)
        derivational = suffix_bases(word, DERIVATIONAL, index)
        prefixed = prefix_bases(word, index)

        def describe(pairs):
            out = []
            for base, shape in pairs:
                base_info = scored(base)
                out.append(
                    {
                        "base": base,
                        "shape": shape,
                        # Whether folding onto this base would actually help, which
                        # is a different question from what the base *displays*.
                        # The cap reads the base's raw Zipf, so a base that is
                        # itself scored from a further base form ("angulateness",
                        # shown at 9.5 via "angulate") is still the sentinel
                        # underneath and would leave the derived form at 10.00.
                        # Those are marked unattested so the fold skips past them
                        # to the base that carries real data.
                        "attested": zipf_at(base) > sentinel,
                        **{f"base_{k}": v for k, v in base_info.items()},
                    }
                )
            return out

        # A base can itself be the misspelled member of a pair: "reaccomodates"
        # folds onto "accomodate" (Zipf 2.45), which is a typo for "accommodate"
        # (4.02). Folding onto a typo bakes the typo in, so flag any base with a
        # materially more common near-spelling of its own.
        variants = []
        seen_pairs = set()
        for source in [word] + [base for base, _ in inflectional + derivational + prefixed]:
            source_zipf = zipf_at(source)
            for candidate in neighbours(source, index, attested):
                if attested[candidate] < source_zipf + 0.5:
                    continue
                if not spelling_variant(source, candidate):
                    continue
                if (source, candidate) in seen_pairs:
                    continue
                seen_pairs.add((source, candidate))
                variants.append(
                    {
                        "spelling": source,
                        "spelling_zipf": source_zipf,
                        "canonical": candidate,
                        "canonical_zipf": attested[candidate],
                    }
                )

        rows.append(
            {
                "word": word,
                **info,
                "inflectional": describe(inflectional),
                "derivational": describe(derivational),
                "prefixed": describe(prefixed),
                "variants": sorted(
                    variants, key=lambda v: -(v["canonical_zipf"] - v["spelling_zipf"])
                )[:3],
                "neighbours": [
                    {"word": n, "zipf": attested[n], "score": scored(n)["display"]}
                    for n in neighbours(word, index, attested)[:4]
                ],
                "family": [
                    {"word": f, "attested": zipf_at(f) > sentinel, "zipf": zipf_at(f)}
                    for f in family(word, index)
                ],
                "provenance": [name for name, words in provenance.items() if word in words],
                "classified": reasons.get(word),
            }
        )

    return {
        "drop": drop,
        "matches": len(matches),
        "sentinel": sentinel,
        "words": sorted(rows, key=lambda r: r["word"]),
    }


def first_attested(row: dict, *keys: str) -> dict | None:
    """The nearest base with a real frequency, searched in the order given."""
    for key in keys:
        for candidate in row[key]:
            if candidate["attested"]:
                return candidate
    return None


def triage(row: dict, min_gap: float) -> str:
    """Which bucket a word lands in -- see the SKILL.md decision order.

    Ordered by which decision the reviewer actually has to make, not by how the
    word is spelled. A word already classified out of modern use is a rejection
    whatever its shape; a fold that would not move the displayed score is not a
    scoring problem at all, and the real question there is whether the word's
    whole family belongs in the dictionary.
    """
    if row["classified"] in ("obsolete", "archaic", "dated"):
        return "classified"
    base = first_attested(row, "inflectional", "derivational")
    if base and row["score"] - base["base_score"] >= min_gap:
        return "demote"
    prefixed = first_attested(row, "prefixed")
    if prefixed and row["score"] - prefixed["base_score"] >= min_gap:
        return "judge"
    if base or row["family"] or row["neighbours"]:
        return "family"
    return "standalone"


def why(row: dict, base: dict) -> str:
    """One sentence for the PR table: what the word is, and what it costs."""
    gap = row["score"] - base["base_score"]
    if base["shape"].endswith("-"):
        shape = f"`{base['shape']}` form"
        cost = "The prefix alone buys"
    elif " " in base["shape"]:
        shape = f"`{base['shape']}` form"
        cost = "The affixes alone buy"
    else:
        shape = SHAPE.get(base["shape"], f"`-{base['shape']}` form")
        cost = "The suffix alone buys"
    return (
        f"{shape[0].upper()}{shape[1:]} of `{base['base']}` ({base['base_display']}), which no "
        f"corpus attests separately. {cost} {gap:.2f} points."
    )


BUCKET_BLURB = {
    "demote": (
        "Demote — suffix form of a measurably more common base",
        "The base is measured and the derived form is not, so the derived form "
        "outranks the word it came from. Fold it onto the base.",
    ),
    "family": (
        "Judge the family — the base is as unscored as the word",
        "Folding these onto their base would not move the displayed score, so "
        "there is no scoring bug to fix. The question is whether the family belongs "
        "in the dictionary at all: an attested near-spelling means a typo family to "
        "reject whole, and no near-spelling means an obscure-but-real family to "
        "leave alone.",
    ),
    "classified": (
        "Reject — already classified out of modern use",
        "Wiktionary recorded this word as obsolete, archaic or dated. The word "
        "rules say those are not eligible for play, so this is a rejection, not a "
        "rescore.",
    ),
    "judge": (
        "Judge — only a prefixed base is available",
        "A prefixed form is a different word from its base and is often genuinely "
        "rarer, so this is not an automatic demotion. Keep it if it reads as a "
        "real word someone would use; demote it to the base only if the prefix is "
        "doing no work.",
    ),
    "standalone": (
        "Judge — no base, no family, no near-spelling",
        "Nothing mechanical explains the score. This is where the fun words live "
        "(`enshittification`), and also where import artefacts hide. Keep unless "
        "you can say what is wrong with it.",
    ),
}
BUCKET_ORDER = ("demote", "classified", "family", "judge", "standalone")


def render(report: dict, date_str: str, min_gap: float, seen_count: int, seen_path: Path | None) -> None:
    rows = report["words"]
    buckets: dict[str, list[dict]] = {}
    for row in rows:
        buckets.setdefault(triage(row, min_gap), []).append(row)

    print(f"# Unscored Legends for drop `{report['drop']}` — puzzle {date_str}\n")
    print(
        f"{report['matches']:,} dictionary words contain the drop. **{len(rows)} of them carry no "
        f"frequency at all** (Zipf {report['sentinel']} sentinel) and therefore score a perfect "
        f"10.00 / Legend.\n"
    )
    print("| bucket | count | decision |")
    print("| --- | --- | --- |")
    verdicts = {
        "demote": "demote to the base",
        "classified": "reject",
        "family": "keep or reject the family",
        "judge": "keep or demote",
        "standalone": "keep unless you can name the fault",
    }
    for key in BUCKET_ORDER:
        print(f"| {BUCKET_BLURB[key][0]} | {len(buckets.get(key, []))} | {verdicts[key]} |")
    print()
    if not rows:
        print("Nothing unscored for this drop.\n")
        return

    def fam_cell(row: dict) -> str:
        return (
            ", ".join(
                f"`{f['word']}`{'' if f['attested'] else ' (unscored)'}" for f in row["family"][:5]
            )
            or "—"
        )

    def spelling_cell(row: dict) -> str:
        """Spelling pairs first (the misspelling tell, and the fold-onto-a-typo trap
        when the pair involves a base), then a couple of plain neighbours as
        context."""
        flagged = {v["spelling"] for v in row["variants"]}
        parts = [
            f"⚠ `{v['spelling']}` (Zipf {v['spelling_zipf']}) vs `{v['canonical']}` "
            f"(Zipf {v['canonical_zipf']})"
            for v in row["variants"]
        ]
        parts += [
            f"`{n['word']}` ({n['score']})"
            for n in row["neighbours"][:2]
            if n["word"] not in flagged
        ]
        return ", ".join(parts) or "none"

    for key in BUCKET_ORDER:
        group = buckets.get(key)
        if not group:
            continue
        title, blurb = BUCKET_BLURB[key]
        print(f"## {title} ({len(group)})\n")
        print(f"{blurb}\n")

        if key == "demote":
            print("| word | score | proposed base | base score | why |")
            print("| --- | --- | --- | --- | --- |")
            # Biggest undeserved gap first: that is where the rank is most wrong.
            for row in sorted(
                group,
                key=lambda r: -(
                    r["score"] - first_attested(r, "inflectional", "derivational")["base_score"]
                ),
            ):
                base = first_attested(row, "inflectional", "derivational")
                nearest = (row["inflectional"] or row["derivational"] or [{}])[0]
                note = why(row, base)
                if nearest.get("base") and nearest["base"] != base["base"]:
                    note += (
                        f" Nearest base `{nearest['base']}` is itself unscored — decide the "
                        "whole family together."
                    )
                print(
                    f"| `{row['word']}` | **{row['display']}** | `{base['base']}` "
                    f"| {base['base_display']} | {note} |"
                )
        elif key == "judge":
            print(
                "| word | prefixed base | nearest suffix base | attested near-spellings "
                "| rest of the family |"
            )
            print("| --- | --- | --- | --- | --- |")
            for row in sorted(
                group, key=lambda r: -(r["score"] - first_attested(r, "prefixed")["base_score"])
            ):
                base = first_attested(row, "prefixed")
                nearest = (row["inflectional"] or row["derivational"] or [{}])[0]
                near_cell = (
                    f"`{nearest['base']}` ({nearest['base_display']})" if nearest.get("base") else "—"
                )
                print(
                    f"| `{row['word']}` | `{base['shape']}` → `{base['base']}` "
                    f"({base['base_display']}) | {near_cell} | {spelling_cell(row)} "
                    f"| {fam_cell(row)} |"
                )
        elif key == "family":
            print("| word | nearest base | attested near-spellings | rest of the family |")
            print("| --- | --- | --- | --- |")
            for row in group:
                nearest = (row["inflectional"] or row["derivational"] or [{}])[0]
                base = (
                    f"`{nearest['base']}` ({nearest['base_display']})" if nearest.get("base") else "—"
                )
                print(f"| `{row['word']}` | {base} | {spelling_cell(row)} | {fam_cell(row)} |")
        else:
            print("| word | rest of the family | attested near-spellings | provenance |")
            print("| --- | --- | --- | --- |")
            for row in group:
                prov = ", ".join(row["provenance"]) or "source word list"
                print(f"| `{row['word']}` | {fam_cell(row)} | {spelling_cell(row)} | {prov} |")
        print()

    print(
        "_Judge every word before applying anything: reject beats rescore (a folded junk word is "
        "still playable), and a fun word scored a little high beats a fun word deleted._"
    )
    if seen_path:
        print(f"\n_Ledger: {seen_path} ({seen_count} words already judged, suppressed above)._")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=".", help="path to the ick checkout")
    ap.add_argument("--date", help="puzzle date YYYY-MM-DD (default: tomorrow, Mountain Time)")
    ap.add_argument("--drop", help="audit this drop instead of the date's drop")
    ap.add_argument("--json", action="store_true", help="emit the full diagnostics as JSON")
    ap.add_argument(
        "--seen",
        default=str(Path(__file__).resolve().parent / "reviewed.txt"),
        help="ledger of already-judged words to suppress; '' disables it",
    )
    ap.add_argument(
        "--min-gap",
        type=float,
        default=0.25,
        help="a suffix form is only proposed for demotion when folding it onto its base moves "
        "the displayed score by at least this much (default 0.25); below that the fold is "
        "invisible to a player and the word is filed under 'judge the family' instead",
    )
    ap.add_argument(
        "--all",
        action="store_true",
        help="ignore the ledger and report every unscored word for the drop",
    )
    args = ap.parse_args()

    root = Path(args.repo).resolve()
    if not (root / "src" / "data" / "dictionary.json").exists():
        sys.exit(f"{root} does not look like the ick repo (no src/data/dictionary.json)")

    date_str = args.date or (datetime.now(MOUNTAIN).date() + timedelta(days=1)).isoformat()
    drops = json.loads((root / "src" / "data" / "drops.json").read_text())
    drop = (args.drop or drop_for_date(date_str, drops)).upper()

    seen_path = Path(args.seen) if args.seen else None
    seen = (
        {w.strip() for w in seen_path.read_text().split() if w.strip()}
        if seen_path and seen_path.exists()
        else set()
    )

    report = build_report(root, drop, seen, args.all)
    if args.json:
        triaged = {r["word"]: triage(r, args.min_gap) for r in report["words"]}
        print(json.dumps({"date": date_str, **report, "triage": triaged}, indent=2))
        return
    render(report, date_str, args.min_gap, len(seen), None if args.all else seen_path)


if __name__ == "__main__":
    main()
