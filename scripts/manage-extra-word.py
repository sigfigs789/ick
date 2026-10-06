#!/usr/bin/env python3
"""Add a curated, suggested, or online word and maintain the regression tests.

Three provenance lists feed the playable dictionary:
  - scripts/extra-words.txt      -> "curated": words the maintainer chose to add
  - scripts/suggested-words.txt  -> "suggested": player-submitted words that were
                                    accepted
  - scripts/online-words.txt     -> "online": rare words discovered online for an
                                    upcoming drop by the "Add rare words found
                                    online" GitHub Action (scripts/find-online-words.py)

All three feed dictionary.json; the split only records where a word came from.
Adding a word inserts it straight into dictionary.json (see insert_into_dictionary)
and then reruns `generate-data.py --refresh-rarity` to grade it -- it no longer
rebuilds the whole list from the ESDB/SCOWL source, whose unpinned upstream made
every run silently re-size and re-score the entire dictionary. A full rebuild
(generate-data.py --word-list) still re-merges all three lists from scratch.
An added word is gated on the frequency waterfall
(wordfreq -> Norvig -> Google Books -> recorded Datamuse values): by default a
word no source attests is
rejected, because its rarity would be a guess rather than a measurement.
`--forced` overrides that and adds the word anyway; the data pipeline then gives
an otherwise-unscored word the rarest-word floor, a perfect 10.0 / Legend.
"""
import argparse
import bisect
import functools
import json
import math
import re
import sys
from pathlib import Path

from frequency import FrequencyWaterfall, bound_base_candidates

ROOT = Path(__file__).resolve().parent.parent
EXTRA_WORDS_PATH = ROOT / "scripts" / "extra-words.txt"
SUGGESTED_WORDS_PATH = ROOT / "scripts" / "suggested-words.txt"
ONLINE_WORDS_PATH = ROOT / "scripts" / "online-words.txt"
BLOCKLIST_PATH = ROOT / "scripts" / "blocklist.txt"
DICTIONARY_PATH = ROOT / "src" / "data" / "dictionary.json"
RARITY_PATH = ROOT / "src" / "data" / "rarity.json"
LEGACY_RARITY_PATH = ROOT / "src" / "data" / "rarity-legacy.json"
SCORE_OVERRIDES_PATH = ROOT / "src" / "data" / "score-overrides.json"
FOLD_EXEMPTIONS_PATH = ROOT / "src" / "data" / "fold-exemptions.json"
ESTIMATED_ZIPF_PATH = ROOT / "src" / "data" / "estimated-zipf.json"
BOUND_RESIDUES_PATH = ROOT / "src" / "data" / "bound-residues.json"
MEASUREMENT_UNITS_PATH = ROOT / "src" / "data" / "measurement-units.json"
DICTIONARY_TEST_PATH = ROOT / "src" / "game" / "dictionary.test.ts"

# Legacy (pre-rescale) rarity placeholders for a freshly added word. The legacy
# arrays are index-aligned with dictionary.json and frozen for past puzzles; a
# new word could never have appeared in one, so its legacy entry is only ever
# read to keep the arrays aligned. We reuse the legacy unknown-frequency values
# (Zipf 1.4 -> tenths 14, displayed as "Extremely Rare"/"X") for that padding.
LEGACY_UNKNOWN_TENTHS = 14
LEGACY_UNKNOWN_CODE = "X"

# Scoring constants, the rarity labels, and the base-form adjustment live with
# word_rarity() below so a recorded word is pinned exactly as the game scores it.

# The provenance lists a word can be added to, and the JS test array that pins
# each one's words with the rarity/Zipf the pipeline gave them.
LISTS = {
    "curated": {
        "path": EXTRA_WORDS_PATH,
        "label": "curated",
        "score_array": "curatedWordScores",
    },
    "suggested": {
        "path": SUGGESTED_WORDS_PATH,
        "label": "suggested",
        "score_array": "suggestedWordScores",
    },
    "online": {
        "path": ONLINE_WORDS_PATH,
        "label": "online",
        "score_array": "onlineWordScores",
    },
}

# English letters only, no upper length cap: long real words like
# "gastroenterologist" are legitimate and playable (submit.ts imposes no cap).
WORD_RE = re.compile(r"^[a-z]+$")
SIZE_ASSERTION_RE = re.compile(r"(expect\(dictionaryWords\)\.toHaveLength\()\d[\d_]*(\);)")

# A `[word, rarity, zipf]` tuple inside a scores array.
SCORE_TUPLE_RE = re.compile(r'\["([a-z]+)",\s*"([^"]+)",\s*(-?[\d.]+)\]')


def dump_word_list(words: list[str]) -> str:
    """Serialize the curated dictionary as one word per line.

    Minified onto a single line, every regen -- and every one-word add -- showed
    up in git as an unreviewable `dictionary.json | 2 +-` over 2.6MB. The list is
    already in ascending sort order, so one element per line makes the diff show
    exactly the words added and removed, in place, with nothing else moving.

    Costs ~6KB gzipped on disk and nothing on the wire: the bundler parses the
    JSON import and re-emits it, so this whitespace never reaches the client.
    No indent -- it is a 225k-line generated file and nothing reads it by eye
    except as a diff. Kept byte-identical to generate-data.py's copy of this
    helper, which writes the same file on a full rebuild.
    """
    return "[\n" + ",\n".join(json.dumps(w) for w in words) + "\n]\n"


def score_array_re(name: str) -> re.Pattern[str]:
    """Match a `const <name>: ReadonlyArray<[string, string, number]> = [ ... ];`."""
    return re.compile(
        rf"(const {name}: ReadonlyArray<\[string, string, number\]> = )\[([\s\S]*?)\](;)"
    )


def listed_words(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {
        line.strip().lower()
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def add_word(raw_word: str, list_name: str, forced: bool) -> None:
    spec = LISTS[list_name]
    path = spec["path"]
    word = raw_word.strip().lower()
    if not WORD_RE.fullmatch(word):
        sys.exit("Word must contain only English letters (a–z).")
    if word in listed_words(BLOCKLIST_PATH):
        sys.exit(f"{word!r} is blocklisted and cannot be added.")
    if word in json.loads(DICTIONARY_PATH.read_text()):
        sys.exit(f"{word!r} is already in the curated dictionary.")
    for other_spec in LISTS.values():
        if word in listed_words(other_spec["path"]):
            sys.exit(
                f"{word!r} is already in the {other_spec['label']} list "
                f"({other_spec['path'].name})."
            )

    # "Has a rarity score" means any corpus in the waterfall attests it:
    # wordfreq, else Norvig, else Google Books, else a recorded Datamuse Zipf
    # (scripts/datamuse-zipf.txt) -- or, for a bound derivational
    # form no corpus attests directly, its base ("aggrandization" -> "aggrandize").
    # Only a word none of these attest is unscored; without --forced that is a
    # hard rejection.
    zipf = FrequencyWaterfall().zipf(word, include_bound=True)
    if zipf is None and not forced:
        sys.exit(
            f"{word!r} has no rarity score in any frequency corpus and was not "
            f"added. Re-run with forced=true to add it anyway (it will score the "
            f"maximum 10.0 / Legend)."
        )

    existing = path.read_text() if path.exists() else ""
    prefix = f"{existing.rstrip()}\n" if existing.strip() else ""
    path.write_text(f"{prefix}{word}\n")

    insert_into_dictionary(word)

    if zipf is not None:
        rating = f"Zipf {zipf:.2f}"
    else:
        rating = "no corpus attests it; forced, will score the maximum 10.0 / Legend"
    print(f"Added {word!r} to {path} as a {spec['label']} word ({rating}).")


def insert_into_dictionary(word: str) -> None:
    """Insert a newly added word into the curated dictionary.json in place.

    The add-word flow grows the existing list by exactly the words added rather
    than rebuilding the whole dictionary from the ESDB/SCOWL source. That rebuild
    cloned an *unpinned* upstream (en-wl/wordlist), so every run re-derived -- and
    silently re-sized and re-scored -- the entire dictionary from whatever the
    source happened to be that day; the mismatch surfaced as align-legacy aborting
    ("off by N entries"). Growing in place keeps the other ~225k words byte-for-byte
    frozen; `generate-data.py --refresh-rarity` afterward recomputes rarity.json
    over the +1 list from the local frequency corpora (no ESDB), and align-legacy
    inserts the matching legacy placeholder.

    dictionary.json is stored in the same ascending sort generate-data.py writes
    (`sorted(...)`, i.e. Python's code-point order), and in the same one-word-per-line
    JSON, so a bisect insert preserves both the order and the on-disk format the
    index-aligned rarity arrays depend on -- and shows up in git as a single added
    line rather than a rewrite of the whole file.
    """
    dictionary = json.loads(DICTIONARY_PATH.read_text())
    # add_word() already rejects a word already present, but stay idempotent so a
    # re-run can't double-insert and desync the rarity arrays.
    if word in dictionary:
        return
    bisect.insort(dictionary, word)
    DICTIONARY_PATH.write_text(dump_word_list(dictionary))
    print(f"Inserted {word!r} into dictionary.json (now {len(dictionary):,} words).")


def update_size_test() -> None:
    count = len(json.loads(DICTIONARY_PATH.read_text()))
    contents = DICTIONARY_TEST_PATH.read_text()
    updated, replacements = SIZE_ASSERTION_RE.subn(
        rf"\g<1>{count:_}\g<2>", contents, count=1
    )
    if replacements != 1:
        sys.exit("Could not find the dictionary-size assertion to update.")
    DICTIONARY_TEST_PATH.write_text(updated)
    print(f"Updated dictionary-size assertion to {count:,}")


# -- Base-form adjustment, mirroring src/game/{dictionary,stem}.ts --------------
# A recorded word must be pinned with the exact rarity/Zipf rarityFor() returns,
# so word_rarity() applies the same adjustment the game does for the newest
# (undated) system -- the 2026-08-16 wide band, where the bound suffixes are on.
# Tense forms inherit their base's Zipf exactly; transparent (-ness/-ly) and
# bound (-ization/-ability) suffixes are capped at their base.
MEASURED_FLOOR = 1.0
BAND_CEILING = 9.9
TAIL_FLOOR = 0.0
# Mirrors SCORE_GAMMA in src/game/dictionary.ts: how far the measured band bends.
# 1 is the straight line every system before DECADE_BANDS_START used.
SCORE_GAMMA = 0.9
# Score cutoffs for the wide band's two top ranks, keyed off the *displayed*
# score, mirroring LEGEND_MIN_SCORE / MYTHIC_MIN_SCORE in src/game/dictionary.ts:
# Legend at a two-decimal score >= 9.9, Mythic wherever the score displays as 9.5+.
LEGEND_MIN_SCORE = 9.9
MYTHIC_MIN_SCORE = 9.5


def _js_round(n: float) -> int:
    """Mirror JavaScript's Math.round (round half up), not Python's round-half-even."""
    return math.floor(n + 0.5)


def _round_to_cents(n: float) -> float:
    """Mirror roundToCents(): two decimals with an upward nudge (9.895 -> 9.90)."""
    return _js_round(n * 100 + 1e-6) / 100


def _round_to_tenths(n: float) -> float:
    """Mirror roundToTenths(): one decimal with an upward nudge (9.45 -> 9.5)."""
    return _js_round(n * 10 + 1e-6) / 10


def _strip_doubled_consonant(stem: str) -> str:
    if len(stem) > 3 and stem[-1] == stem[-2] and stem[-1] in "bcdfghjklmnpqrstvwxyz":
        return stem[:-1]
    return stem


def _inflectional_stem(word: str) -> str:
    """Mirror of baseForm() in src/game/stem.ts (tense/plural only)."""
    w = word.lower()
    if len(w) > 5 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 6 and w.endswith("ying"):
        return w[:-4] + "y"
    if len(w) > 5 and w.endswith("ing"):
        return _strip_doubled_consonant(w[:-3])
    if len(w) > 5 and w.endswith("ied"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith("ed"):
        return _strip_doubled_consonant(w[:-2])
    if len(w) > 4 and w.endswith("es"):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def _inflectional_candidates(word: str, latin_plurals: bool) -> list[str]:
    """Mirror of inflectionalBaseCandidates() in src/game/stem.ts.

    Every base spelling a plural or third-person form could have. Unlike
    _inflectional_stem above, which must commit to one key, this offers the whole
    set and lets the caller keep the most common one the dictionary attests.
    Candidates under three letters are dropped: two-letter dictionary entries
    carry the corpus frequency of every word containing them.
    """
    w = word.lower()
    out: list[str] = []

    def add(*bases: str) -> None:
        for base in bases:
            if len(base) >= 3 and base != w and base not in out:
                out.append(base)

    if len(w) > 5 and w.endswith("ices"):
        add(w[:-4] + "ex", w[:-4] + "ix")
    if len(w) > 4 and w.endswith("ies"):
        add(w[:-3] + "y", w[:-3] + "i")
    if len(w) > 4 and w.endswith("ves"):
        add(w[:-3] + "f", w[:-3] + "fe")
    if len(w) > 4 and w.endswith("men"):
        add(w[:-3] + "man")
    if len(w) > 4 and w.endswith("es"):
        add(w[:-1], w[:-2], w[:-2] + "is")
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        add(w[:-1])
    # Latin plurals, only where the caller's guard says the spelling can be
    # read that way (see latinPluralsAllowed in dictionary.ts).
    if latin_plurals:
        if len(w) > 3 and w.endswith("ae"):
            add(w[:-1])
        if len(w) > 3 and w.endswith("i"):
            add(w[:-1] + "us")
        if len(w) > 4 and w.endswith("a"):
            add(w[:-1] + "um")
    return out


def _inflected_form_candidates(word: str) -> list[str]:
    """Mirror of inflectedFormCandidates() in src/game/stem.ts.

    Every spelling `word`'s own regular inflections could take -- the one
    generator that runs forward, from a base toward the forms built on it,
    because it serves the one fold that runs that way. Deliberately
    over-generates; the caller's round trip decides (see _inflected_form_folds).
    """
    w = word.lower()
    out: list[str] = []

    def add(*forms: str) -> None:
        for form in forms:
            if form != w and form not in out:
                out.append(form)

    add(w + "s", w + "es", w + "ed", w + "ing")
    if w.endswith("e"):
        add(w + "d", w[:-1] + "ing")
    if w.endswith("y") and len(w) > 2:
        add(w[:-1] + "ies", w[:-1] + "ied")
    if w.endswith("ie") and len(w) > 2:
        add(w[:-2] + "ying")
    last = w[-1] if w else ""
    if len(w) > 2 and last in "bcdfghjklmnpqrstvwxz":
        add(w + last + "ed", w + last + "ing")
    return out


def _degree_candidates(word: str) -> list[tuple[str, str]]:
    """Mirror of degreeBaseCandidates() in src/game/stem.ts.

    The "-y" adjective an "-ier"/"-iest" word would be a degree of, paired with
    the other degree of the same base. The caller requires both to be dictionary
    words: "happy" has "happiest" so "happier" folds, while "copy" has no
    "copiest" so the agent noun "copier" keeps its own measured score.
    """
    w = word.lower()
    if len(w) > 5 and w.endswith("iest"):
        stem = w[:-4]
        return [(stem + "y", stem + "ier")]
    if len(w) > 4 and w.endswith("ier"):
        stem = w[:-3]
        return [(stem + "y", stem + "iest")]
    return []


def _superlative_candidates(word: str) -> list[tuple[str, str]]:
    """Mirror of superlativeBaseCandidates() in src/game/stem.ts.

    The adjective a bare "-est" superlative is the top degree of, paired with the
    "-er" comparative of the same spelling. The same paired-degree check as
    _degree_candidates(), on the spelling the MEASURED_FLOOR gate used to hold:
    "realest" folds because "realer" is a word, "contest" does not because
    "conter" is not. Seven letters minimum, and a three-letter base only where a
    doubled consonant vouches for the suffix ("biggest" -> "big").
    """
    w = word.lower()
    if len(w) <= 6 or not w.endswith("est") or w.endswith("iest"):
        return []
    stem = w[:-3]
    counterpart = stem + "er"
    out: list[tuple[str, str]] = []

    def add(base: str, minimum: int) -> None:
        if len(base) >= minimum and base != w and all(base != b for b, _ in out):
            out.append((base, counterpart))

    add(stem, 4)
    add(stem + "e", 4)
    add(_strip_doubled_consonant(stem), 3)
    return out


def _unmeasured_candidates(word: str) -> list[str]:
    """Mirror of unmeasuredBaseCandidates() in src/game/stem.ts.

    Suffixes whose spelling is not decisive -- "-er"/"-est" comparatives and
    agentives, and the Latin neuter plural "-a" -> "-um". The caller admits these
    only for a word below MEASURED_FLOOR, where its score is a stand-in rather
    than a measurement.
    """
    w = word.lower()
    out: list[str] = []

    def add(*bases: str) -> None:
        for base in bases:
            if len(base) >= 4 and base != w and base not in out:
                out.append(base)

    for suffix in ("est", "er"):
        if not w.endswith(suffix) or len(w) <= len(suffix) + 3:
            continue
        stem = w[: -len(suffix)]
        # For "-ier"/"-iest" the "-y" rewrite is the only candidate; the other
        # i-stem candidates let junk chain somewhere real ("campi" -> "campus").
        # See unmeasuredBaseCandidates in stem.ts.
        if stem.endswith("i"):
            add(stem[:-1] + "y")
            continue
        add(stem, stem + "e", _strip_doubled_consonant(stem))

    # Bare "-ize"/"-ise" only: a tensed form folds through its own verb (see
    # _ize_verb_spellings). The "y" candidate reaches the noun a verb was
    # built from.
    for suffix in ("ize", "ise"):
        if not w.endswith(suffix) or len(w) <= len(suffix) + 3:
            continue
        stem = w[: -len(suffix)]
        add(stem, stem + "e", stem + "y")
    for suffix in ("ably", "ibly", "able", "ible"):
        if not w.endswith(suffix) or len(w) <= len(suffix) + 3:
            continue
        stem = w[: -len(suffix)]
        add(stem, stem + "e", stem + "y")
    return out


# Mirror of TRANSPARENT_PREFIXES in src/game/stem.ts.
TRANSPARENT_PREFIXES = ("counter", "under", "anti", "over", "out", "de", "un")
# Left out: "re", "co", "dis" -- productive, but English fossilised them onto
# Latin stems ("refel" -> "fell", "cosh" -> "she", "copious" -> "pious"). The
# full reasoning is the block comment above TRANSPARENT_PREFIXES in
# src/game/stem.ts. "de" was the fourth until 2026-10-04, when it joined behind
# a reviewed table: the readings it gets wrong ("delate" -> "late") are
# prefix-scoped entries in fold-exemptions.json, which
# load_prefix_fold_exemptions() reads. See DE_PREFIX_START in dictionary.ts.
#
# On 2026-09-05 "pre" went the same way ("precaution" is not a caution, "prefab"
# not a fab), and with it every borrowed prefix -- the classical combining forms
# and the Latinate ones alike. They attach to bound stems as readily as to
# English words, so a residue that is a word can be a coincidence ("protocol" ->
# "cole", "telephony" -> "phony", "subsister" -> "sister", "postface" -> "face").
# What is left is the six above, which take free-standing English words. This
# mirror follows the latest system only, so it drops the retired prefixes
# outright where stem.ts keeps them behind date flags for the archived puzzles
# that folded them -- see PRE_PREFIX_END and BORROWED_PREFIX_END.


def _prefix_candidates(word: str) -> list[str]:
    """Mirror of prefixBaseCandidates() in src/game/stem.ts.

    The base a prefixed word was built on ("nonplaying" -> "playing"). Admitted
    only below MEASURED_FLOOR: ungated these fold "mistake" -> "take" and
    "understand" -> "stand", both measured far above the floor. (Examples have
    to come from the prefixes actually listed -- "coward" and, since
    2026-09-05, "preface" cannot reach this function at all, because "co"
    and "pre" are not in TRANSPARENT_PREFIXES.)
    """
    w = word.lower()
    out: list[str] = []
    for prefix in TRANSPARENT_PREFIXES:
        if not w.startswith(prefix):
            continue
        stem = w[len(prefix):]
        if len(stem) < 4 or stem == w or stem in out:
            continue
        out.append(stem)
    return out


# Mirror of UNGATED_PREFIXES in src/game/stem.ts: the two prefixes that fold
# whatever the word's own frequency says, from 2026-09-27 (see
# UNGATED_PREFIX_START in dictionary.ts). The other four in TRANSPARENT_PREFIXES
# stay behind the MEASURED_FLOOR gate, because their letters are also the opening
# of a pile of ordinary words ("overt", "outer", "unit") and these two are not.
UNGATED_PREFIXES = ("counter", "anti")


def _ungated_prefix_candidates(word: str) -> list[str]:
    """Mirror of ungatedPrefixBaseCandidates() in src/game/stem.ts."""
    w = word.lower()
    for prefix in UNGATED_PREFIXES:
        if not w.startswith(prefix):
            continue
        stem = w[len(prefix):]
        if len(stem) < 4 or stem == w:
            continue
        return [stem]
    return []


# Mirror of MEASUREMENT_PREFIXES in src/game/stem.ts.
MEASUREMENT_PREFIXES = (
    "yocto", "zepto", "yotta", "zetta", "femto", "hecto", "centi", "micro",
    "milli", "deka", "deca", "deci", "kilo", "mega", "giga", "tera", "peta",
    "nano", "pico", "atto", "yobi", "zebi", "exbi", "pebi", "tebi", "gibi",
    "mebi", "kibi", "exa",
)


def _measurement_candidates(word: str) -> list[str]:
    """Mirror of measurementBaseCandidates() in src/game/stem.ts.

    The unit a measurement modifier is counting ("kilojoules" -> "joules"). The
    caller checks the residue against the reviewed unit table, and that check --
    not a frequency gate -- is what earns this family its fold above
    MEASURED_FLOOR. Three letters rather than the prefix rule's four, because
    the table is the guard and it admits "amp", "bar", "bit", "ohm" and "ton".
    """
    w = word.lower()
    out: list[str] = []
    for prefix in MEASUREMENT_PREFIXES:
        if not w.startswith(prefix):
            continue
        unit = w[len(prefix):]
        if len(unit) < 3 or unit == w or unit in out:
            continue
        out.append(unit)
    return out


def _derived_candidates(word: str) -> list[str]:
    """Mirror of derivedBaseCandidates() in src/game/stem.ts.

    The bound derivational families: an ending English only ever produces by
    attaching that suffix, so no frequency gate is needed -- the ending is what
    makes them safe. "-ically" -> "-ic", "-ably"/"-ibly" -> "-able"/"-ible",
    "-ologist" -> "-ology", the c -> ck orthography, and the French "-eaux".
    """
    w = word.lower()
    out: list[str] = []

    def add(base: str) -> None:
        if len(base) >= 3 and base != w and base not in out:
            out.append(base)

    # Each bound is the shortest word the family actually has ("epically",
    # "stably", "oologist", "beaux"), not a round number.
    if len(w) > 7 and w.endswith("ically"):
        add(w[:-4])
    if len(w) > 5 and w.endswith("ably"):
        add(w[:-4] + "able")
    if len(w) > 5 and w.endswith("ibly"):
        add(w[:-4] + "ible")
    if len(w) > 6 and w.endswith("ologist"):
        add(w[:-3] + "y")
    for suffix in ("cked", "cking"):
        # Both spellings: "chocked" is a tense of "chock", not of "choc", and
        # the caller's most-common check is what tells them apart. "-cker" is
        # deliberately absent either way: it folds "blockers" -> "bloc".
        if w.endswith(suffix) and len(w) > len(suffix) + 2:
            add(w[: -len(suffix)] + "c")
            add(w[: -len(suffix)] + "ck")
    if len(w) > 4 and w.endswith("eaux"):
        add(w[:-1])
    return out


def _privative_candidates(word: str) -> list[str]:
    """Mirror of privativeBaseCandidates() in src/game/stem.ts.

    The word a "-less" adjective is the absence of ("kindless" -> "kind").
    Ungated like the bound families above: the strip takes nothing away, and the
    handful of words that merely end that way leave a residue no dictionary
    attests ("bless" -> "b", "unless" -> "un"). The "-lessly"/"-lessness"
    derivatives need no rule -- the "-ly"/"-ness" strips reach the adjective and
    it folds onward from there.
    """
    w = word.lower()
    out: list[str] = []

    def add(base: str) -> None:
        if len(base) >= 3 and base != w and base not in out:
            out.append(base)

    if w.endswith("less") and len(w) > 6:
        stem = w[:-4]
        add(stem)
        # The one spelling change the suffix makes ("pitiless" -> "pity"), and
        # the doubled "l" it collapses ("skill" + -less -> "skilless").
        if stem.endswith("i"):
            add(stem[:-1] + "y")
        if stem.endswith("l"):
            add(stem + "l")
    return out


def _doubling_tense_stem(word: str) -> str | None:
    """Mirror of doublingTenseStem() in stem.ts.

    The bare stem of an "-ed"/"-ing" ending English would have doubled the final
    consonant of, so the ending was never added to that spelling: "wan" takes
    "wanning", never "waning". A stressed monosyllable ending in a single
    consonant after a single vowel, with "h", "w", "x" and "y" left out because
    they never double.
    """
    w = word.lower()
    if len(w) > 5 and w.endswith("ing") and not w.endswith("ying"):
        stem = w[:-3]
    elif len(w) > 4 and w.endswith("ed"):
        stem = w[:-2]
    else:
        return None
    return stem if re.fullmatch(r"[^aeiouy]*[aeiouy][bcdfgklmnprstvz]", stem) else None


def _blocked_tense_stem(word: str, index: dict[str, int]) -> str | None:
    """Mirror of blockedTenseStem() in dictionary.ts (2026-09-10 on).

    Paired with the silent-"e" reading being a word, so the rule only ever moves
    a fold between two readings of one ending and never takes the last one a
    spelling has ("busing" keeps `bus`).
    """
    stem = _doubling_tense_stem(word)
    if stem is None:
        return None
    return stem if (stem + "e") in index else None


_UNATTESTED_ZIPF: float | None = None


def _unattested_zipf() -> float:
    """The unattested sentinel: the lowest Zipf rarity.json carries."""
    global _UNATTESTED_ZIPF
    if _UNATTESTED_ZIPF is None:
        _UNATTESTED_ZIPF = min(json.loads(RARITY_PATH.read_text())["zipfHundredths"]) / 100
    return _UNATTESTED_ZIPF


def _reinflected_residue(word: str, index: dict[str, int], zipf_at) -> str | None:
    """Mirror of reinflectedResidue() in dictionary.ts (2026-10-04 on).

    The "-s" form a spelling would have to be inflected again to produce
    ("hearses" -> "hears", "finessed" -> "fines"), refused where the silent-"e"
    reading of the same letters ("hearse", "finesse") is a measured word.
    """
    if len(word) > 4 and word.endswith("es"):
        residue, rival = word[:-2], word[:-1]
    else:
        if len(word) > 5 and word.endswith("ing"):
            stem = word[:-3]
        elif len(word) > 4 and word.endswith("ed"):
            stem = word[:-2]
        else:
            return None
        if not stem.endswith("ss"):
            return None
        residue, rival = stem[:-1], stem + "e"
    if not re.search(r"[^s]s$", residue):
        return None
    if residue[:-1] not in index or rival not in index:
        return None
    if zipf_at(rival) == _unattested_zipf():
        return None
    return residue


def _tense_base(word: str, index: dict[str, int], zipf_at) -> str | None:
    """Mirror of tenseBaseForm(): -ed/-ing pick the most common valid base.

    The newest system caps against this base rather than inheriting it outright,
    so it can only pull a word toward common. It also counts five-letter -ied
    forms ("tried", "cried"), which the older systems missed, and lets an -ied
    word try the plain -ed bases too ("taxied" -> "taxi").
    """
    candidates: list[str] = []
    # The bare-stem reading this spelling cannot carry, from 2026-09-10. Dropping
    # it drops the doubled-consonant trim beside it too, which is the same string
    # for these stems.
    blocked = _blocked_tense_stem(word, index)
    ied = len(word) > 4 and word.endswith("ied")
    if ied:
        candidates.append(word[:-3] + "y")
    if len(word) > 4 and word.endswith("ed"):
        stem = word[:-2]
        candidates.append(stem + "e")
        if stem != blocked:
            candidates += [stem, _strip_doubled_consonant(stem)]
    if len(word) > 4 and word.endswith("ying"):
        candidates += [word[:-4] + "y", word[:-4] + "ie"]
    elif len(word) > 5 and word.endswith("ing"):
        stem = word[:-3]
        candidates.append(stem + "e")
        if stem != blocked:
            candidates += [stem, _strip_doubled_consonant(stem)]
    base, base_zipf = None, float("-inf")
    for candidate in candidates:
        if candidate in index and zipf_at(candidate) > base_zipf:
            base, base_zipf = candidate, zipf_at(candidate)
    return base


def _scoring_base(word: str, index: dict[str, int]) -> str | None:
    """Mirror of scoringBaseForm() with the bound suffixes on (wide-band era)."""
    inflected = _inflectional_stem(word)
    if inflected != word and inflected in index:
        return inflected
    for suffix in ("ness", "ly"):
        if not word.endswith(suffix) or len(word) <= len(suffix) + 2:
            continue
        stem = word[: -len(suffix)]
        for candidate in (stem, stem[:-1] + "y" if stem.endswith("i") else ""):
            if candidate and candidate in index:
                return candidate
    for candidate in bound_base_candidates(word):
        if candidate in index:
            return candidate
    return None


def decade_rarity(score: float) -> str:
    """Mirrors decadeRarity() in src/game/dictionary.ts (the latest labels).

    The rank is whatever whole point the shown score displays in, so the leading
    digit is the rank. Elusive keeps the half band above them (9.0..9.4) and Very
    Common takes everything under 5.0.
    """
    shown = _round_to_tenths(score)
    if shown >= 9:
        return "Elusive"
    if shown >= 8:
        return "Extremely Rare"
    if shown >= 7:
        return "Rare"
    if shown >= 6:
        return "Uncommon"
    if shown >= 5:
        return "Common"
    return "Very Common"


def measured_rarity(zipf: float) -> str:
    """Mirrors measuredRarity() in src/game/dictionary.ts (narrow bands).

    Superseded by decade_rarity() from DECADE_BANDS_START on; kept because the
    audit skills still read archived puzzles' labels through it.
    """
    if zipf >= 4.85:
        return "Very Common"
    if zipf >= 3.9:
        return "Common"
    if zipf >= 3.15:
        return "Uncommon"
    if zipf >= 2.13:
        return "Rare"
    if zipf >= 1.59:
        return "Extremely Rare"
    return "Elusive"


def current_score(zipf: float, max_zipf: float) -> float:
    """Displayed 0..10 rarity score for a Zipf, mirroring WIDE_SCORING.

    Both bands round to two decimals with the same upward nudge the app uses
    (roundToCents), so the elite top of the scale has the resolution its Legend/
    Mythic cutoffs key off. The measured band fills 0..BAND_CEILING; the deep tail
    (Zipf < MEASURED_FLOOR) fills BAND_CEILING..10, clamped at TAIL_FLOOR -> 10.
    """
    if zipf >= MEASURED_FLOOR:
        x = (max_zipf - zipf) / (max_zipf - MEASURED_FLOOR)
        return _round_to_cents(BAND_CEILING * (x**SCORE_GAMMA))
    clamped = max(zipf, TAIL_FLOOR)
    score = BAND_CEILING + (10 - BAND_CEILING) * (MEASURED_FLOOR - clamped) / (
        MEASURED_FLOOR - TAIL_FLOOR
    )
    return _round_to_cents(min(score, 10))


def top_rank_for_score(score: float) -> str | None:
    """Mirror of topRankForScore(): the score-based Legend/Mythic ranks, or None.

    Legend keys off the two-decimal score (>= 9.9); Mythic off the one-decimal
    score (rounds to >= 9.5). Below that the caller falls back to the Zipf-band
    label. Kept identical to src/game/dictionary.ts so a pinned label can't drift.
    """
    if _round_to_cents(score) >= LEGEND_MIN_SCORE:
        return "Legend"
    if _round_to_tenths(score) >= MYTHIC_MIN_SCORE:
        return "Mythic"
    return None


def rarity_label(zipf: float, max_zipf: float) -> str:
    """Mirror of WIDE_SCORING.rarity(): the top ranks key off the *score*.

    The deep tail is not flatly "Mythic" -- a word scoring >= 9.9 is "Legend".
    So the label is derived from the displayed score (topRankForScore), falling
    back to the whole-point label below the Mythic cutoff.
    """
    score = current_score(zipf, max_zipf)
    return top_rank_for_score(score) or decade_rarity(score)


def format_score(score: float) -> str:
    """Mirror of WIDE_SCORING.format(): two decimals for Mythic/Legend (score >=
    9.5), one decimal (with the upward nudge) otherwise, matching the app."""
    if score >= MYTHIC_MIN_SCORE:
        return f"{score:.2f}"
    return f"{_round_to_tenths(score):.1f}"


@functools.cache
def load_score_overrides() -> dict[str, dict]:
    """The curated base-form demotions in src/data/score-overrides.json.

    Mirror of SCORE_OVERRIDES in src/game/dictionary.ts. Every override is active
    here because this module only ever scores a word under the newest (undated)
    system, where each entry's `since` date has passed by definition.

    Cached: adjusted_zipf() consults it per word, and callers that sweep the whole
    dictionary (the audit skill) would otherwise re-read the file 225k times.
    """
    if not SCORE_OVERRIDES_PATH.exists():
        return {}
    return json.loads(SCORE_OVERRIDES_PATH.read_text())


@functools.cache
def load_fold_exemptions() -> frozenset[str]:
    """The curated fold exemptions in src/data/fold-exemptions.json.

    Mirror of FOLD_EXEMPTIONS in src/game/dictionary.ts: an exempt word
    contributes no fold candidates at all, so it scores on its own data and no
    chain passes through it. Every entry is active here because this module only
    scores under the newest (undated) system.

    Scoped entries are not here -- see load_prefix_fold_exemptions().
    """
    if not FOLD_EXEMPTIONS_PATH.exists():
        return frozenset()
    entries = json.loads(FOLD_EXEMPTIONS_PATH.read_text())
    return frozenset(w for w, entry in entries.items() if not entry.get("scope"))


@functools.cache
def load_prefix_fold_exemptions() -> frozenset[str]:
    """The entries scoped to the prefix hop ("scope": "prefix").

    Mirror of prefixFoldExempt(): these refuse the prefix strip alone and leave
    the word's ordinary folds running, which is what a wrong *bracketing* needs
    ("antiphonic" is antiphon + -ic, but "antibodies" is still the plural of
    "antibody").
    """
    if not FOLD_EXEMPTIONS_PATH.exists():
        return frozenset()
    entries = json.loads(FOLD_EXEMPTIONS_PATH.read_text())
    return frozenset(w for w, entry in entries.items() if entry.get("scope") == "prefix")



def load_bound_residues() -> frozenset[str]:
    """The residues a prefix fold may not land on.

    Mirror of BOUND_RESIDUES in src/game/dictionary.ts: a bound combining form
    the dictionary lists as an entry ("lith", "crat", "phyte"), which is not a
    word a fold should ever show as a base. Replaced the flat Zipf-3 floor on
    2026-08-26 -- "is this residue a word" and "is this residue common" are
    different questions, and the floor answered the wrong one in both
    directions ("snob" at 2.96 refused, "dont" at 4.74 admitted).
    """
    if not BOUND_RESIDUES_PATH.exists():
        return frozenset()
    return frozenset(json.loads(BOUND_RESIDUES_PATH.read_text()))


def load_measurement_units() -> frozenset[str]:
    """The unit spellings a measurement modifier may fold onto.

    Mirror of MEASUREMENT_UNITS in src/game/dictionary.ts: an allow-list, where
    the bound residues next door deny. A modifier is transparent -- a kilojoule
    is a joule -- but its letters open ordinary words ("decadent", "examine",
    "petaline"), and this family cannot lean on the MEASURED_FLOOR gate because
    the words it exists for are measured. So the check moves to the residue.
    """
    if not MEASUREMENT_UNITS_PATH.exists():
        return frozenset()
    return frozenset(json.loads(MEASUREMENT_UNITS_PATH.read_text()))


def _override_base(word: str, index: dict[str, int]) -> str | None:
    """Mirror of overrideBase() for the newest system (no date gating)."""
    override = load_score_overrides().get(word)
    if not override:
        return None
    base = override.get("base")
    return base if base in index else None


# Mirror of MAX_FOLD_DEPTH in src/game/dictionary.ts.
MAX_FOLD_DEPTH = 8


def _next_bases(word: str, index: dict[str, int], zipf_at) -> list[str]:
    """Mirror of nextBaseForms(): every base `word` could fold onto in one hop.

    A reviewed exemption silences every rule, the override included; a reviewed
    override replaces the spelling guesses rather than joining them. Otherwise
    the whole candidate set is returned and chained_base() explores it, because
    "which base is most common" and "which base leads to the most common word"
    are different questions.
    """
    if word in load_fold_exemptions():
        return []

    override = _override_base(word, index)
    if override:
        return [override]

    out: list[str] = []

    def add(candidate: str | None) -> None:
        if not candidate or candidate == word:
            return
        if candidate not in index or candidate in out:
            return
        out.append(candidate)

    for candidate in _inflectional_bases(word, index, zipf_at):
        add(candidate)
    for candidate in _non_inflectional_bases(word, index, zipf_at):
        add(candidate)
    return out


def _inflectional_bases(word: str, index: dict[str, int], zipf_at) -> list[str]:
    """Mirror of inflectionalBaseForms(): the rival readings of one ending.

    Every candidate here is a different guess at the same fold and at most one
    can be right ("wives" is "wife", "wif", "wiv" or "wive"), which is what the
    reverse fold's round trip asks its question of. The rungs in
    _non_inflectional_bases() are not rivals -- they are further up the same
    ladder -- and letting them win that question took paradigms apart (see
    inflectedFormFolds in dictionary.ts).
    """
    if word in load_fold_exemptions():
        return []
    override = _override_base(word, index)
    if override:
        return [override]

    out: list[str] = []
    # The reading the word's own spelling rules out, whichever family offers it:
    # _inflectional_stem() reaches the bare stem too (see _blocked_tense_stem).
    blocked = _blocked_tense_stem(word, index)
    reinflected = _reinflected_residue(word, index, zipf_at)

    def add(candidate: str | None) -> None:
        if not candidate or candidate == word or candidate in (blocked, reinflected):
            return
        if candidate not in index or candidate in out:
            return
        out.append(candidate)

    add(_tense_base(word, index, zipf_at))
    add(_inflectional_stem(word))
    for candidate in _inflectional_candidates(word, (word + "s") not in index):
        add(candidate)
    # "-ier"/"-iest" comparatives, ungated -- the paired-degree check stands in
    # for the frequency gate (see degreeBaseCandidates in stem.ts).
    for base, counterpart in _degree_candidates(word):
        if counterpart in index:
            add(base)
    # Bare "-est", on the same check: the comparative in the same spelling is
    # what tells a superlative from a word that merely ends that way. Its "-er"
    # half stays gated (see superlativeBaseCandidates in stem.ts).
    for base, counterpart in _superlative_candidates(word):
        if counterpart in index:
            add(base)
    return out


def _non_inflectional_bases(word: str, index: dict[str, int], zipf_at) -> list[str]:
    """Mirror of nonInflectionalBaseForms(): the rungs above `word`."""
    if word in load_fold_exemptions():
        return []
    override = _override_base(word, index)
    if override:
        return [override]

    out: list[str] = []
    # _scoring_base() below reaches the bare tense stem through
    # _inflectional_stem(), so the blocked reading has to be refused here too --
    # in the TS this file mirrors, one candidateAdder covers both sets.
    blocked = _blocked_tense_stem(word, index)
    reinflected = _reinflected_residue(word, index, zipf_at)

    def add(candidate: str | None) -> None:
        if not candidate or candidate == word or candidate in (blocked, reinflected):
            return
        if candidate not in index or candidate in out:
            return
        out.append(candidate)

    if word in index and zipf_at(word) < MEASURED_FLOOR:
        # Tensed "-ize"/"-ise" forms are deliberately absent from the gated
        # set: they fold through their own verb (see nextBaseForms).
        for candidate in _unmeasured_candidates(word):
            add(candidate)
        # The rest of the transparent prefixes, under the same gate. What a
        # prefix base has to survive is _prefix_bases(), shared with the ungated
        # pair below so the two cannot drift.
        for candidate in _prefix_bases(word, _prefix_candidates(word), index, zipf_at):
            add(candidate)
    # "counter-" and "anti-", off that gate: the two prefixes with no measured
    # words for a floor to protect, so the strip runs on the word's own spelling
    # alone ("counterattack" -> "attack", "antiviral" -> "viral"). See
    # UNGATED_PREFIX_START in dictionary.ts.
    #
    # The corpus half of that cutover has no mirror here: this module scores off
    # the curated list, so a base only the 1.2M-word corpus carries
    # ("antiabortionism" -> `abortionism`, "antichrist" -> `christ`) is one it
    # cannot see. It reports the word rarer than the game does, never commoner,
    # which is the safe direction for a script whose job is to catch a word
    # scoring higher than it should.
    for candidate in _prefix_bases(word, _ungated_prefix_candidates(word), index, zipf_at):
        add(candidate)
    # The measurement modifiers, ungated on the reviewed unit table rather than
    # on an ending: "kilojoules" -> "joules" though both are measured.
    units = load_measurement_units()
    for candidate in _measurement_candidates(word):
        if candidate in units:
            add(candidate)
    # The bound derivational families, ungated like the "-ization" pair below:
    # nothing accidental ends "-ically" or "-ibly" (see derivedBaseCandidates).
    for candidate in _derived_candidates(word):
        add(candidate)
    # The privative "-less" family, ungated for the same reason: a word
    # "without X" is a derivation of X (see privativeBaseCandidates).
    for candidate in _privative_candidates(word):
        add(candidate)
    add(_scoring_base(word, index))
    return out


def _prefix_fold_exempt_paradigm(word: str, index: dict[str, int], zipf_at) -> bool:
    """Mirror of prefixFoldExemptParadigm(): the entry covers the paradigm.

    A scoped entry names one word, and its inflections reach the same strip on
    their own ("antibodies" offers `bodies` without ever passing through
    "antibody"). Reading one step back is what keeps the file's promise that an
    entry covers the paradigm, rather than asking review to list every inflection
    of every wrong bracketing.
    """
    exempt = load_prefix_fold_exemptions()
    if word in exempt:
        return True
    return any(base in exempt for base in _inflectional_bases(word, index, zipf_at))


def _prefix_bases(
    word: str, spellings: list[str], index: dict[str, int], zipf_at
) -> list[str]:
    """Mirror of addPrefixBases(): the prefix strips that survive review.

    A residue has to be a word rather than a bound combining form ("neolith" ->
    "lith"), which the reviewed table answers and not a frequency floor -- see
    load_bound_residues(). The whole hop is refused for a reviewed wrong
    bracketing, and where the word reads as a bare "-est" superlative: a degree
    suffix owns the bracketing, so the prefix belongs to the adjective inside it
    ("uncleanest" is the superlative of "unclean", not un- + "cleanest"). See
    hasSuperlativeReading in dictionary.ts.
    """
    if not spellings:
        return []
    if _prefix_fold_exempt_paradigm(word, index, zipf_at):
        return []
    if any(
        base in index and counterpart in index
        for base, counterpart in _superlative_candidates(word)
    ):
        return []
    bound = load_bound_residues()
    return [c for c in spellings if c in index and c not in bound]


def _most_common(candidates: list[str], word: str, index: dict[str, int], zipf_at) -> str | None:
    """Mirror of mostCommonBase(): the most common candidate the dictionary has."""
    base, base_zipf = None, float("-inf")
    for candidate in candidates:
        if candidate == word or candidate not in index:
            continue
        zipf = zipf_at(candidate)
        if zipf > base_zipf:
            base, base_zipf = candidate, zipf
    return base


def _derived_form_folds(word: str, index: dict[str, int], zipf_at) -> list[str]:
    """Mirror of derivedFormFolds(): the "-ic"/"-ical"/"-ous" adjective built on
    `word`, where that adjective is the half of the pair anyone writes
    ("neolith" 0.98 against "neolithic" 2.99).

    Gated at MEASURED_FLOOR rather than round-tripped, because there is no
    forward "-ic" rule to check against -- and every accidental pair the
    spelling allows ("pan"/"panic", "top"/"topic") sits far above the floor.
    """
    if word in load_fold_exemptions() or _override_base(word, index):
        return []
    if word not in index or zipf_at(word) >= MEASURED_FLOOR:
        return []
    return [
        form
        for form in _derived_form_candidates(word)
        if form in index and zipf_at(form) >= MEASURED_FLOOR
    ]


def _derived_form_candidates(word: str) -> list[str]:
    """Mirror of derivedFormCandidates() in src/game/stem.ts."""
    w = word.lower()
    if len(w) < 5:
        return []
    out: list[str] = []
    stems = [w, w[:-1]] if w.endswith("e") else [w]
    for stem in stems:
        for suffix in ("ic", "ical", "ous"):
            form = stem + suffix
            if form != w and form not in out:
                out.append(form)
    return out


def _inflected_form_folds(
    word: str, index: dict[str, int], zipf_at, floor: float = float("-inf")
) -> list[str]:
    """Mirror of inflectedFormFolds(): the inflections `word` is capped at.

    The fold's second direction, added 2026-08-24. A candidate counts only if
    the forward rules run on it *choose* `word` back -- the same round trip the
    TypeScript uses, which is what keeps "singe" off "singing" and "wive" off
    "wives". A reviewed exemption or override on `word` silences it, and
    chained_base() never walks on from what it finds here.
    """
    if word in load_fold_exemptions() or _override_base(word, index):
        return []
    out: list[str] = []
    for form in _inflected_form_candidates(word):
        if form not in index:
            continue
        # The frequency test before the round trip: a cap only pulls toward
        # common, so a form no commoner than what the caller has cannot change
        # the answer, and confirming the link is the expensive half. Only above
        # MEASURED_FLOOR, from 2026-08-26: below it a form rarer than the word
        # may still climb somewhere commoner ("semiweeklies" strips its prefix
        # to "weekly"), which is the half the skip used to lose.
        if zipf_at(form) <= floor and zipf_at(form) >= MEASURED_FLOOR:
            continue
        if (
            _most_common(_inflectional_bases(form, index, zipf_at), form, index, zipf_at)
            != word
        ):
            continue
        out.append(form)
    return out


def chained_base(word: str, index: dict[str, int], zipf_at) -> tuple[str, float] | None:
    """Mirror of chainedBase(): the most common word reachable by folding.

    Each link is one hop applied again to whatever it lands on, so
    "materialnesses" -> "materialness" -> "material" rather than stopping at the
    unattested middle. Every branch is explored, not just the most common first
    hop: committing to one hop can prune the path the chain needed ("cleanses"
    offers both "cleanse", which folds no further, and "cleans", which carries on
    to "clean"). From 2026-08-24 it also caps against the inflections built *on*
    each word it visits (_inflected_form_folds), without walking on from them.
    From 2026-09-27 (SHORTER_FORMS_START) the winner is never longer than the
    word itself; the walk still passes through longer forms on the way.
    Returns (base, zipf), or None when nothing folds.
    """
    seen = {word}
    frontier = [word]
    best: tuple[str, float] | None = None
    own = zipf_at(word) if word in index else float("-inf")

    def eligible(form: str) -> bool:
        return len(form) <= len(word)

    for _ in range(MAX_FOLD_DEPTH):
        if not frontier:
            break
        nxt: list[str] = []
        for current in frontier:
            for candidate in _next_bases(current, index, zipf_at):
                if candidate in seen:
                    continue
                seen.add(candidate)
                nxt.append(candidate)
                zipf = zipf_at(candidate)
                if eligible(candidate) and (best is None or zipf > best[1]):
                    best = (candidate, zipf)
            # The same direction one family further out, and fully terminal.
            for form in _derived_form_folds(current, index, zipf_at):
                zipf = zipf_at(form)
                if eligible(form) and (best is None or zipf > best[1]):
                    best = (form, zipf)
            # The other direction: terminal for the *inflectional* hops and
            # transparent to the rest, so a paradigm reaches the base its own
            # members found without a rival reading of a form composing across
            # paradigms ("cleanses" -> "cleans" -> "clean"). See
            # inflectedFormFolds in dictionary.ts.
            floor = max(own, best[1] if best is not None else float("-inf"))
            for form in _inflected_form_folds(current, index, zipf_at, floor):
                zipf = zipf_at(form)
                if eligible(form) and (best is None or zipf > best[1]):
                    best = (form, zipf)
                for above in _non_inflectional_bases(form, index, zipf_at):
                    if above in seen:
                        continue
                    seen.add(above)
                    nxt.append(above)
                    above_zipf = zipf_at(above)
                    if eligible(above) and (best is None or above_zipf > best[1]):
                        best = (above, above_zipf)
        frontier = nxt
    return best


_ESTIMATED_ZIPF: dict[str, float] | None = None


def estimated_zipf(word: str) -> float | None:
    """Claude's estimated Zipf for `word`, mirroring `withEstimate` in
    src/game/dictionary.ts for the newest system, where every estimate is live.
    A word estimated twice keeps its earliest batch, as the game does."""
    global _ESTIMATED_ZIPF
    if _ESTIMATED_ZIPF is None:
        _ESTIMATED_ZIPF = {}
        since: dict[str, str] = {}
        if ESTIMATED_ZIPF_PATH.exists():
            for batch in json.loads(ESTIMATED_ZIPF_PATH.read_text())["batches"]:
                for w, z in batch["zipf"].items():
                    if w in since and since[w] <= batch["since"]:
                        continue
                    since[w] = batch["since"]
                    _ESTIMATED_ZIPF[w] = z
    return _ESTIMATED_ZIPF.get(word)


def adjusted_zipf(word: str, index: dict[str, int], zipf_at) -> float:
    """Mirror of adjustedZipf() in src/game/dictionary.ts (newest system)."""
    own = zipf_at(word)
    # Claude's estimate stands in for the sentinel, as `withEstimate` does.
    if own == _unattested_zipf():
        estimate = estimated_zipf(word)
        if estimate is not None:
            own = max(estimate, own)
    chained = chained_base(word, index, zipf_at)
    return max(own, chained[1]) if chained is not None else own


def word_rarity(word: str) -> tuple[float, str, float]:
    """(zipf, rarity label, displayed score) as the game scores it (undated/newest).

    Applies the same base-form adjustment as rarityFor() so the pinned value can
    never drift from what a player sees.
    """
    dictionary = json.loads(DICTIONARY_PATH.read_text())
    rarity = json.loads(RARITY_PATH.read_text())
    hundredths = rarity["zipfHundredths"]
    index = {w: i for i, w in enumerate(dictionary)}
    if word not in index:
        sys.exit(f"{word!r} is not in dictionary.json; regenerate the data first.")

    def zipf_at(w: str) -> float:
        return hundredths[index[w]] / 100

    zipf = round(adjusted_zipf(word, index, zipf_at), 2)
    max_zipf = max(hundredths) / 100
    score = current_score(zipf, max_zipf)
    label = rarity_label(zipf, max_zipf)
    return zipf, label, score


def record_word(raw_word: str, list_name: str) -> None:
    """Log the added word's Zipf/score and pin them in the dictionary test.

    Reads the regenerated rarity data, so run this after generate-data.py (and
    --refresh-rarity) so a forced, otherwise-unscored word shows its final 10.0.
    """
    array_name = LISTS[list_name]["score_array"]
    word = raw_word.strip().lower()
    zipf, label, score = word_rarity(word)
    print(
        f"{word!r} scored: Zipf {zipf} -> rarity score {format_score(score)} "
        f"({label}) on the WordInk scale."
    )

    contents = DICTIONARY_TEST_PATH.read_text()
    match = score_array_re(array_name).search(contents)
    if not match:
        sys.exit(f"Could not find the {array_name} scores array.")

    entries = {
        w: (rarity, float(z)) for w, rarity, z in SCORE_TUPLE_RE.findall(match.group(2))
    }
    entries[word] = (label, zipf)
    lines = "".join(
        f"  [{json.dumps(w)}, {json.dumps(r)}, {json.dumps(z)}],\n"
        for w, (r, z) in sorted(entries.items())
    )
    replacement = f"{match.group(1)}[\n{lines}]{match.group(3)}"
    updated = contents[: match.start()] + replacement + contents[match.end() :]
    DICTIONARY_TEST_PATH.write_text(updated)
    print(f"Pinned {word!r} ({label}, Zipf {zipf}) in the {array_name} test.")


def align_legacy(raw_words: list[str]) -> None:
    """Keep rarity-legacy.json index-aligned after one or more words are added.

    generate-data.py rebuilds dictionary.json and rarity.json, but the frozen
    legacy rarity arrays are not regenerated. Inserting each new word's
    placeholder at its sorted position preserves every existing legacy value
    while keeping the arrays the same length as the dictionary (see
    LEGACY_UNKNOWN_* above). Inserting the words in ascending final-index order
    keeps every remaining target index valid as the arrays grow.
    """
    words = sorted({w.strip().lower() for w in raw_words})
    dictionary = json.loads(DICTIONARY_PATH.read_text())
    legacy = json.loads(LEGACY_RARITY_PATH.read_text())
    tenths = legacy["zipfTenths"]
    codes = legacy["codes"]

    if len(tenths) == len(dictionary):
        print("rarity-legacy.json already aligned; nothing to insert.")
        return

    indexes = []
    for word in words:
        try:
            indexes.append(dictionary.index(word))
        except ValueError:
            sys.exit(f"{word!r} is not in dictionary.json; regenerate the data first.")
    if len(tenths) != len(dictionary) - len(words):
        sys.exit(
            f"rarity-legacy.json is off by {len(dictionary) - len(tenths)} entries; "
            f"expected exactly {len(words)} missing. Refusing to guess the alignment."
        )

    for index in sorted(indexes):
        tenths.insert(index, LEGACY_UNKNOWN_TENTHS)
        codes = codes[:index] + LEGACY_UNKNOWN_CODE + codes[index:]
    legacy["codes"] = codes
    legacy["zipfTenths"] = tenths
    LEGACY_RARITY_PATH.write_text(json.dumps(legacy, separators=(",", ":")))
    joined = ", ".join(f"{w!r}@{i}" for w, i in zip(words, sorted(indexes)))
    print(f"Inserted {len(words)} legacy alignment placeholder(s): {joined}.")


def main() -> None:
    parser = argparse.ArgumentParser()
    command = parser.add_subparsers(dest="command", required=True)

    add = command.add_parser("add")
    add.add_argument("word")
    add.add_argument("--list", choices=LISTS, default="curated", dest="list_name")
    add.add_argument("--forced", action="store_true")

    command.add_parser("update-size-test")

    record = command.add_parser("record-word")
    record.add_argument("word")
    record.add_argument("--list", choices=LISTS, default="curated", dest="list_name")

    legacy = command.add_parser("align-legacy")
    legacy.add_argument("words", nargs="+")

    args = parser.parse_args()

    if args.command == "add":
        add_word(args.word, args.list_name, args.forced)
    elif args.command == "update-size-test":
        update_size_test()
    elif args.command == "align-legacy":
        align_legacy(args.words)
    else:
        record_word(args.word, args.list_name)


if __name__ == "__main__":
    main()
