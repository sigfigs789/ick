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
(wordfreq -> Norvig -> Google Books): by default a word no corpus attests is
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
from collections import deque
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
    # wordfreq, else Norvig, else Google Books -- or, for a bound derivational
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
# (undated) system: the 2026-08-16 wide band with the bound suffixes on, and the
# 2026-08-21 fold, which searches every plausible spelling of a base rather than
# the one the stemmer produces. Every fold is a *cap* -- a word scores no rarer
# than the most common word it can reach -- so nothing here can make a word rarer
# than its own measurement.
MEASURED_FLOOR = 1.0
BAND_CEILING = 9.9
TAIL_FLOOR = 0.0
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


def _tense_base(word: str, index: dict[str, int], zipf_at) -> str | None:
    """Mirror of tenseBaseForm(): -ed/-ing pick the most common valid base.

    The newest system caps against this base rather than inheriting it outright,
    so it can only pull a word toward common. It also counts five-letter -ied
    forms ("tried", "cried"), which the older systems missed.
    """
    candidates: list[str] = []
    if len(word) > 4 and word.endswith("ied"):
        candidates.append(word[:-3] + "y")
    elif len(word) > 4 and word.endswith("ed"):
        stem = word[:-2]
        candidates += [stem + "e", stem, _strip_doubled_consonant(stem)]
    if len(word) > 4 and word.endswith("ying"):
        candidates += [word[:-4] + "y", word[:-4] + "ie"]
    elif len(word) > 5 and word.endswith("ing"):
        stem = word[:-3]
        candidates += [stem + "e", stem, _strip_doubled_consonant(stem)]
    base, base_zipf = None, float("-inf")
    for candidate in candidates:
        if candidate in index and zipf_at(candidate) > base_zipf:
            base, base_zipf = candidate, zipf_at(candidate)
    return base


def _inflection_base_candidates(word: str, latin_plurals: bool) -> list[str]:
    """Mirror of inflectionBaseCandidates(): every plausible inflectional base.

    Candidates rather than one answer is the point -- _inflectional_stem() returns
    a single spelling and so gives up when it is not a word ("asphyxiates" ->
    "asphyxiat", never "asphyxiate").

    The Latin rules are gated on `latin_plurals`, which the caller decides: the
    "-a"/"-i"/"-ae" endings are as ambiguous as bare "-er", and no frequency
    threshold separates them (see _latin_plurals_allowed).
    """
    w = word.lower()
    out: list[str] = []

    def add(base: str) -> None:
        if len(base) >= 3 and base != w and base not in out:
            out.append(base)

    if len(w) > 4 and w.endswith("ies"):
        add(w[:-3] + "y")
        add(w[:-2])
        add(w[:-1])
    if len(w) > 4 and w.endswith("ves"):
        add(w[:-3] + "f")
        add(w[:-3] + "fe")
    if len(w) > 4 and w.endswith("es"):
        add(w[:-2])
        add(w[:-1])
        add(w[:-2] + "is")
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        add(w[:-1])
    if latin_plurals:
        if len(w) > 3 and w.endswith("i"):
            add(w[:-1] + "us")
        if len(w) > 3 and w.endswith("ae"):
            add(w[:-1])
        if len(w) > 3 and w.endswith("a"):
            add(w[:-1] + "um")
    if len(w) > 4 and w.endswith("ied"):
        add(w[:-3] + "y")
    if len(w) > 4 and w.endswith("ed"):
        add(w[:-1])
        add(w[:-2])
        add(_strip_doubled_consonant(w[:-2]))
    if len(w) > 4 and w.endswith("ying"):
        add(w[:-4] + "y")
        add(w[:-4] + "ie")
    if len(w) > 5 and w.endswith("ing"):
        add(w[:-3] + "e")
        add(w[:-3])
        add(_strip_doubled_consonant(w[:-3]))
    return out


def _degree_base_candidates(word: str, plain_degrees: bool) -> list[str]:
    """Mirror of degreeBaseCandidates(): comparative/superlative bases.

    `plain_degrees` selects the riskier half -- bare -er/-est is also how English
    builds agent nouns, so the caller only turns it on below MEASURED_FLOOR.
    """
    w = word.lower()
    out: list[str] = []

    def add(base: str) -> None:
        if len(base) >= 3 and base != w and base not in out:
            out.append(base)

    if len(w) > 5 and w.endswith("iest"):
        add(w[:-4] + "y")
    elif len(w) > 4 and w.endswith("ier"):
        add(w[:-3] + "y")
    elif plain_degrees:
        if len(w) > 4 and w.endswith("est"):
            add(w[:-2])
            add(w[:-3])
            add(_strip_doubled_consonant(w[:-3]))
        elif len(w) > 3 and w.endswith("er"):
            add(w[:-1])
            add(w[:-2])
            add(_strip_doubled_consonant(w[:-2]))
    return out


def _degree_counterpart(word: str, base: str) -> str | None:
    """Mirror of degreeCounterpart(): the other degree, in `word`'s own spelling.

    The spelling has to match rather than merely exist in the paradigm: English
    doubles a CVC monosyllable, so "fun" takes "funner"/"funnest" and never
    "funer"/"funest". Accepting either variant let "funnest" vouch for the
    Latinate "funest".
    """
    w = word.lower()
    b = base.lower()
    doubled = b + b[-1]
    if b.endswith("y"):
        variants = [(b[:-1] + "ier", b[:-1] + "iest")]
    else:
        first = (b + "r", b + "st") if b.endswith("e") else (b + "er", b + "est")
        variants = [first, (doubled + "er", doubled + "est")]
    for comparative, superlative in variants:
        if w == comparative:
            return superlative
        if w == superlative:
            return comparative
    return None


def _gradable_fold(word: str, base: str, index: dict[str, int]) -> bool:
    """Mirror of gradableFold(): `base` is attested in both degrees."""
    counterpart = _degree_counterpart(word, base)
    return counterpart is not None and counterpart in index


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


def measured_rarity(zipf: float) -> str:
    """Mirrors measuredRarity() in src/game/dictionary.ts (narrow bands)."""
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
        score = BAND_CEILING * (max_zipf - zipf) / (max_zipf - MEASURED_FLOOR)
        return _round_to_cents(score)
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
    back to the measured Zipf-band label below the Mythic cutoff.
    """
    return top_rank_for_score(current_score(zipf, max_zipf)) or measured_rarity(zipf)


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
def load_fold_exemptions() -> dict[str, dict]:
    """The curated fold exemptions in src/data/fold-exemptions.json.

    Mirror of FOLD_EXEMPTIONS in src/game/dictionary.ts. Active unconditionally
    here for the same reason the overrides are: this module only scores under the
    newest (undated) system.
    """
    if not FOLD_EXEMPTIONS_PATH.exists():
        return {}
    return json.loads(FOLD_EXEMPTIONS_PATH.read_text())


def _override_base(word: str, index: dict[str, int]) -> str | None:
    """Mirror of overrideBase() for the newest system (no date gating)."""
    override = load_score_overrides().get(word)
    if not override:
        return None
    base = override.get("base")
    return base if base in index else None


# Mirror of MAX_FOLD_NODES in src/game/dictionary.ts. The newest system fans out
# over every plausible spelling instead of walking one chain, so the budget counts
# words visited rather than chain length.
MAX_FOLD_NODES = 64


def _latin_plurals_allowed(word: str, index: dict[str, int]) -> bool:
    """Mirror of latinPluralsAllowed(): may `word` be read as a Latin plural?

    The "-a"/"-i"/"-ae" endings are as ambiguous as bare "-er", and the
    measurement floor cannot help -- "alba" (Zipf 3.33) is more common than
    "curricula" or "foci". Taking an English plural of its own is what separates
    them: a Latin plural has no "-s" form, so "albas" existing means "alba" is an
    English singular. Catches the metal-oxide family ("aluminas", "magnesias")
    that the floor would have let through.
    """
    return word + "s" not in index


def _fold_candidates(word: str, index: dict[str, int], zipf_at) -> list[str]:
    """Mirror of foldCandidates(): every base `word` could fold onto.

    The union of the reviewed override, the tense rule, the suffix rules, and
    every plausible inflectional or degree spelling. Taking the union rather than
    the first rule to match is strictly safer -- a cap against the best of several
    bases is never rarer than a cap against any one of them.

    An exempt word contributes nothing, which stops it folding and stops a chain
    passing through it.
    """
    if word in load_fold_exemptions():
        return []

    out: list[str] = []

    def add(base: str | None) -> None:
        if base is not None and base != word and base not in out and base in index:
            out.append(base)

    add(_override_base(word, index))
    add(_tense_base(word, index, zipf_at))
    add(_scoring_base(word, index))
    for candidate in _inflection_base_candidates(word, _latin_plurals_allowed(word, index)):
        add(candidate)
    plain_degrees = word in index and zipf_at(word) < MEASURED_FLOOR
    for candidate in _degree_base_candidates(word, plain_degrees):
        if _gradable_fold(word, candidate, index):
            add(candidate)
    return out


def most_common_fold(word: str, index: dict[str, int], zipf_at) -> tuple[str, float] | None:
    """Mirror of mostCommonFold(): the most common word reachable by folding.

    A breadth-first search over the fold graph rather than a single chain, so
    "materialnesses" -> "materialness" -> "material" rather than stopping at the
    unattested middle, and "asphyxiates" reaches "asphyxiate" even though the
    stemmer's own spelling ("asphyxiat") is not a word. The winner is the most
    common word reached, so folding can only ever make a word more common.
    Returns (base, zipf), or None when nothing folds.
    """
    visited = {word}
    queue = deque([word])
    best: tuple[str, float] | None = None
    while queue:
        if len(visited) >= MAX_FOLD_NODES:
            break
        current = queue.popleft()
        for candidate in _fold_candidates(current, index, zipf_at):
            if candidate in visited:
                continue
            visited.add(candidate)
            zipf = zipf_at(candidate)
            if best is None or zipf > best[1]:
                best = (candidate, zipf)
            queue.append(candidate)
    return best


def adjusted_zipf(word: str, index: dict[str, int], zipf_at) -> float:
    """Mirror of adjustedZipf() in src/game/dictionary.ts (newest system)."""
    own = zipf_at(word)
    folded = most_common_fold(word, index, zipf_at)
    return max(own, folded[1]) if folded is not None else own


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
