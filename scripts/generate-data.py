#!/usr/bin/env python3
"""
Data generation pipeline for Ick.

Produces two SEPARATE artifacts, per design:
  - src/data/dictionary.json  -> the curated list of words a submission is checked against
  - src/data/rarity.json      -> each word's frequency (Zipf, in hundredths), index-aligned
  - src/data/rarity-scale.json -> the highest and lowest of those, for the score scale
  - src/data/rejection-metadata.json -> concise explanations for excluded ESDB entries
  - src/data/derived-rejections.json -> dictionary words that carry a rejection reason
    (obsolete/archaic/dated/abbreviation/proper noun), dated from when they stop being
    playable (the list keeps them, so old puzzles still score)

Frequency (via the `wordfreq` package) determines rarity. The curated
dictionary determines whether a submission is allowed at all. They are kept
separate so the "is this a word" question and the "how rare is it" question
can be tuned independently.

Run:
    pip3 install --user wordfreq
    python3 scripts/generate-data.py
    python3 scripts/generate-data.py --word-list /path/to/scowl-us-60.txt
"""
import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

from frequency import FrequencyWaterfall

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WORD_LIST = Path("/usr/share/dict/words")
OUT_DIR = ROOT / "src" / "data"
BLOCKLIST_PATH = ROOT / "scripts" / "blocklist.txt"
EXTRA_WORDS_PATH = ROOT / "scripts" / "extra-words.txt"
SUGGESTED_WORDS_PATH = ROOT / "scripts" / "suggested-words.txt"
ONLINE_WORDS_PATH = ROOT / "scripts" / "online-words.txt"
WIKTIONARY_ACCEPTED_PATH = ROOT / "scripts" / "wiktionary-accepted.txt"
WIKTIONARY_REASONS_PATH = ROOT / "scripts" / "wiktionary-reasons.json"
DERIVED_REJECTIONS_PATH = OUT_DIR / "derived-rejections.json"
PLAYABLE_EXEMPTIONS_PATH = ROOT / "scripts" / "playable-exemptions.txt"

MIN_LEN = 1

# The reasons that say a word has fallen out of use, rather than that it was never
# an ordinary word. Only these are gated by frequency -- see write_derived_rejections.
OUT_OF_USE_REASONS = {"obsolete", "archaic", "dated"}

# The Zipf at or above which an out-of-use classification is ignored. Kept in
# lockstep with the DERIVED_REJECTIONS comment in src/game/dictionary.ts.
OUT_OF_USE_ZIPF_CEILING = 2.5

# Words absent from every source (wordfreq, Norvig, Google Books, Datamuse) are the
# rarest we can attest -- floored to 0.0 so they earn the top displayed score.
UNKNOWN_ZIPF = 0.0

# wordfreq's measurement floor. Everything wordfreq can score sits at or above
# this; the "deep tail" (words only Norvig/Google Books attest, plus the
# found-nowhere floor) is remapped strictly below it so a single Zipf boundary
# separates the two scoring bands. See rarityScore in src/game/dictionary.ts:
# measured words fill scores 0..9.5, the deep tail gets its own 9.5..10 band.
MEASURED_FLOOR = 1.0

# Rarity bucket boundaries (inclusive lower bound), tuned by eyeballing the
# resulting distribution -- see the printed histogram when this script runs.
# These are intentionally generous toward "common" since the goal is that a
# player using everyday words still gets a satisfying, mostly-green result.
# Retuned once (see NARROW_BANDS_START in src/game/dictionary.ts): Extremely
# Rare used to start at 2.5 and covered better than a third of the words any
# drop could reach, which made it the default rather than a find. Rare /
# Extremely Rare / Elusive now take an even third each of that crowded top range,
# and Quotidian -- and later Very Common -- were folded into Common. Keep these
# in lockstep with measuredRarity() there and measured_rarity() in
# manage-extra-word.py. The deep tail (Zipf < MEASURED_FLOOR) is its own top rank, so these bands
# only cover the measured range.
RARITY_BANDS = [
    (3.9, "Common"),
    (3.15, "Uncommon"),
    (2.13, "Rare"),
    (1.59, "Extremely Rare"),
    (1.0, "Elusive"),
]

WORD_RE = re.compile(r"^[a-z]+$")

def dump_word_list(words: list[str]) -> str:
    """Serialize the curated dictionary as one word per line.

    Minified onto a single line, every regen -- and every one-word add -- showed
    up in git as an unreviewable `dictionary.json | 2 +-` over 2.6MB. The list is
    already in ascending sort order, so one element per line makes the diff show
    exactly the words added and removed, in place, with nothing else moving.

    Costs ~6KB gzipped on disk and nothing on the wire: the bundler parses the
    JSON import and re-emits it, so this whitespace never reaches the client.
    No indent -- it is a 225k-line generated file and nothing reads it by eye
    except as a diff. Kept byte-identical to manage-extra-word.py's copy of this
    helper, which grows the same file in place.
    """
    return "[\n" + ",\n".join(json.dumps(w) for w in words) + "\n]\n"


def rarity_for_zipf(z: float) -> str:
    if z < MEASURED_FLOOR:
        return "Mythic"  # the deep-tail library is its own top rank
    for threshold, label in RARITY_BANDS:
        if z >= threshold:
            return label
    return RARITY_BANDS[-1][1]


def refresh_rarity() -> None:
    """Recompute rarity.json over the existing dictionary.json using the
    frequency waterfall, without rebuilding the curated word list itself.

    Two bands, split at MEASURED_FLOOR:
      - Words wordfreq can measure keep their real Zipf (>= MEASURED_FLOOR)
        and later map to displayed scores 0..9.5.
      - The deep tail (words only Norvig/Google Books attest, plus words no
        corpus attests) is ranked by its raw log-frequency and remapped into
        [0, MEASURED_FLOOR), later mapping to the elite 9.5..10 band. Words
        found nowhere sit at the 0.0 floor -> a perfect 10.0.
    """
    dictionary = json.loads((OUT_DIR / "dictionary.json").read_text())

    waterfall = FrequencyWaterfall()
    raw = [waterfall.zipf(word) for word in dictionary]

    # Words no corpus attests are the rarest we can claim, so they get a
    # sentinel just below the rarest *attested* Zipf -- reserving the perfect
    # 10.0 for them while an attested-but-vanishingly-rare word lands just under.
    attested = [z for z in raw if z is not None]
    sentinel = round(min(attested) - 0.1, 2)
    zipfs = [z if z is not None else sentinel for z in raw]

    deep = sum(1 for z in zipfs if z < MEASURED_FLOOR)
    unattested = sum(1 for z in raw if z is None)
    print(
        f"Frequency sources: Norvig {len(waterfall.norvig)}, "
        f"Google Books {len(waterfall.google)} (offset {round(waterfall.google_offset, 4)}), "
        f"Datamuse {len(waterfall.datamuse)}"
    )
    print(
        f"Bands: measured/common {len(dictionary) - deep} (score 0..9.5), "
        f"deep tail {deep} (Zipf < {MEASURED_FLOOR}, score 9.5..10); "
        f"{unattested} unattested at the {sentinel} sentinel -> 10.0"
    )

    from collections import Counter

    hist = Counter(rarity_for_zipf(z) for z in zipfs)
    for label in ("Mythic", *[label for _, label in RARITY_BANDS]):
        print(f"  {label:16s} {hist.get(label, 0)}")

    write_rarity([round(z * 100) for z in zipfs])
    print(f"Wrote {OUT_DIR / 'rarity.json'} ({len(dictionary)} entries, index-aligned)")


def write_rarity(zipf_hundredths: list[int]) -> None:
    """Write rarity.json and the two numbers the score scale is drawn from.

    The game fetches rarity.json after it starts (see `scoringReady` in
    src/game/dictionary.ts), but it needs the scale's ends to show a saved
    score before then, so they ship on their own in rarity-scale.json. A test
    (src/game/rarity-scale.test.ts) keeps the two files in step.
    """
    (OUT_DIR / "rarity.json").write_text(
        json.dumps({"zipfHundredths": zipf_hundredths}, separators=(",", ":"))
    )
    (OUT_DIR / "rarity-scale.json").write_text(
        json.dumps(
            {"maxZipfHundredths": max(zipf_hundredths), "minZipfHundredths": min(zipf_hundredths)},
            separators=(",", ":"),
        )
    )


def displayed_zipf(z: float) -> float:
    """Match the one-decimal Zipf value stored and shown by the app."""
    return round(z * 10) / 10


def load_blocklist() -> set[str]:
    if not BLOCKLIST_PATH.exists():
        return set()
    words = set()
    for line in BLOCKLIST_PATH.read_text().splitlines():
        # Trailing comments are stripped, not just whole-line ones. The file
        # invites a note beside an entry ("niggardly  # sounds like a slur
        # despite unrelated etymology") and reading the line whole turned those
        # two entries into strings no word can equal, which quietly un-blocked
        # them -- "niggardly" shipped in the dictionary for it.
        line = line.partition("#")[0].strip().lower()
        if line:
            words.add(line)
    return words


def load_word_file(path: Path) -> set[str]:
    if not path.exists():
        return set()
    words = set()
    for line in path.read_text().splitlines():
        line = line.strip().lower()
        if line and not line.startswith("#") and WORD_RE.match(line):
            words.add(line)
    return words


def load_extra_words() -> set[str]:
    return load_word_file(EXTRA_WORDS_PATH)


def load_suggested_words() -> set[str]:
    return load_word_file(SUGGESTED_WORDS_PATH)


def load_online_words() -> set[str]:
    return load_word_file(ONLINE_WORDS_PATH)


def load_wiktionary_words() -> set[str]:
    return load_word_file(WIKTIONARY_ACCEPTED_PATH)


# Reasons that mark a word as ineligible for play regardless of source. Wiktionary
# can supply lowercase spellings of the name/abbreviation ones (e.g. "paris"),
# which SCOWL excludes only because it lists them capitalized, so the supplement
# is filtered against this set; "misspelling" is Wiktionary-only (ESDB/SCOWL
# never emits it). The out-of-use reasons (obsolete/archaic/dated) are
# intentionally absent: they only enrich the *rejection message* for words that
# were already excluded, and never drop a currently playable word.
ALWAYS_EXCLUDED_REASONS = {"abbreviation", "proper-noun", "name-or-abbreviation", "misspelling"}

# Every rejection reason ranked by strength. When a word is classified more than
# once -- across ESDB entries, or between ESDB and Wiktextract -- the strongest
# reason wins so the player sees the most specific explanation. Name/abbreviation
# reasons outrank the out-of-use reasons, and within out-of-use "obsolete" (dead)
# outranks "archaic" outranks "dated" (merely old-fashioned). "misspelling" wins
# over everything: it's the most specific and unambiguous reason a word can have.
REASON_PRIORITY = {
    "dated": 1,
    "archaic": 2,
    "obsolete": 3,
    "name-or-abbreviation": 4,
    "proper-noun": 5,
    "abbreviation": 6,
    "misspelling": 7,
}


def load_wiktionary_reasons() -> dict[str, str]:
    """Invert scripts/wiktionary-reasons.json into a {word: strongest reason} map.

    The file is built by import-wiktionary-words.py from the Wiktextract dump and
    groups words by reason; a word can appear under only one reason there, but we
    still resolve by REASON_PRIORITY to stay robust to future overlaps.
    """
    if not WIKTIONARY_REASONS_PATH.exists():
        return {}
    grouped = json.loads(WIKTIONARY_REASONS_PATH.read_text())
    reasons: dict[str, str] = {}
    for reason, words in grouped.items():
        for word in words:
            if reason not in REASON_PRIORITY:
                continue
            if word not in reasons or REASON_PRIORITY[reason] > REASON_PRIORITY[reasons[word]]:
                reasons[word] = reason
    return reasons


def merge_reasons(*maps: dict[str, str]) -> dict[str, str]:
    """Combine {word: reason} maps, keeping the strongest reason per word."""
    merged: dict[str, str] = {}
    for reasons in maps:
        for word, reason in reasons.items():
            if reason not in REASON_PRIORITY:
                continue
            if word not in merged or REASON_PRIORITY[reason] > REASON_PRIORITY[merged[word]]:
                merged[word] = reason
    return merged


def esdb_classification(esdb_db: Path) -> dict[str, str]:
    """Strongest ESDB-derived reason for each lowercase word.

    A word can have several ESDB entries, so collect the strongest explanation
    for its lower-case form. This ignores whether the word is currently
    accepted; callers decide how to use the classification (rejection messages
    vs. keeping names/abbreviations out of the merged word list).
    """
    import sqlite3

    if not esdb_db.exists():
        sys.exit(f"ESDB database not found at {esdb_db}")

    reasons: dict[str, str] = {}
    query = """
        select distinct word, base_pos, pos_class, size
        from scowl_v0
    """
    with sqlite3.connect(esdb_db) as conn:
        for word, base_pos, pos_class, size in conn.execute(query):
            normalized = word.lower()
            if not WORD_RE.match(normalized):
                continue

            reason = None
            if base_pos == "abbr" or word.isupper():
                reason = "abbreviation"
            elif pos_class in {"person", "surname", "place", "name", "name?"}:
                reason = "proper-noun"
            elif word != word.lower():
                # ESDB marks some capitalized entries only as `upper`; it
                # explicitly documents that this classification is incomplete.
                # Keep the user-facing explanation accurate without guessing.
                reason = "name-or-abbreviation"
            elif size >= 85:
                # ESDB describes size 85 words as valid but potentially no
                # longer used in modern English.
                reason = "obsolete"

            if reason and (
                normalized not in reasons
                or REASON_PRIORITY[reason] > REASON_PRIORITY[reasons[normalized]]
            ):
                reasons[normalized] = reason
    return reasons


def rejection_metadata(classification: dict[str, str], dictionary: set[str]) -> dict[str, str]:
    """High-confidence reasons for ESDB words excluded from the game.

    The game intentionally ships a small, static map instead of ESDB's full
    SQLite database. Accepted words are dropped so a word is never both playable
    and flagged; unknown words are left out and receive the normal curated-list
    message in the client.
    """
    return {word: reason for word, reason in classification.items() if word not in dictionary}


def load_playable_exemptions() -> set[str]:
    """Words held playable despite a rejection reason (scripts/playable-exemptions.txt).

    The pressure valve for the derived rejections below: a word Wiktionary marks
    out of use that the game wants anyway, listed one per line. Deliberately a
    keep-list rather than hand-edits to the generated file, which a refresh would
    simply re-add.
    """
    return load_word_file(PLAYABLE_EXEMPTIONS_PATH)


def write_derived_rejections(
    classification: dict[str, str],
    dictionary: list[str],
    zipf_hundredths: list[int],
    today: str,
) -> tuple[int, int]:
    """Record every curated word that carries a rejection reason, dated and grouped.

    ALWAYS_EXCLUDED_REASONS only keeps a classified word from *entering* the list,
    and the out-of-use reasons never did even that, so words already on the list
    stayed playable whatever Wiktionary said about them -- and an obsolete spelling
    scored on its own vanishing frequency: "ranck" (an obsolete form of "rank")
    came out a 9.58 Mythic where "rank" scores 4.80. The rule is now simply that a
    word with a reason is unplayable, and the player is told the reason.

    This file is what makes that retroactive without removing anything: the word
    keeps its dictionary slot and its rarity entry, so archived puzzles still score
    it, and src/game/dictionary.ts refuses it from its recorded date on.

    The out-of-use reasons are gated at OUT_OF_USE_ZIPF_CEILING, and that gate is
    the guard the family needs: their false positives are precisely the common
    words -- "halt" (Zipf 3.93), "fraught" (3.12) and "guerilla" (2.90) are each
    tagged obsolete off one dead sense, "thy" and "unto" archaic, "fortnight" and
    "yea" dated -- while below the gate the tag is reliable. A word corpora still
    measure in live use is not out of use, whatever a sense label says. The
    structural reasons (abbreviation, proper noun, misspelling) take no gate:
    Wiktionary gives those to a headword with no ordinary sense at all, and "cd"
    being common says nothing about whether it is an abbreviation.

    Entries already in the file keep their original date and are never dropped: a
    rejection is a verdict, so it survives a data refresh, and dating each batch
    separately keeps a refresh from retroactively invalidating an archived puzzle.
    Returns (newly added, total).
    """
    existing: dict[str, dict[str, list[str]]] = (
        json.loads(DERIVED_REJECTIONS_PATH.read_text()) if DERIVED_REJECTIONS_PATH.exists() else {}
    )
    judged = {
        word for batch in existing.values() for words in batch.values() for word in words
    }
    exempt = load_playable_exemptions()
    # An exemption also *undoes* a rejection already recorded: the keep-list is the
    # one thing that can take a word back out of this file, which is what makes it
    # a usable answer to a bad label rather than advice to hand-edit generated data.
    for batch in existing.values():
        for reason, words in list(batch.items()):
            batch[reason] = [word for word in words if word not in exempt]
            if not batch[reason]:
                del batch[reason]
    for date_key in [key for key, batch in existing.items() if not batch]:
        del existing[date_key]
    judged -= exempt
    zipf_of = dict(zip(dictionary, zipf_hundredths))
    added: dict[str, list[str]] = {}
    for word, reason in classification.items():
        if word not in zipf_of or word in judged or word in exempt:
            continue
        if reason in OUT_OF_USE_REASONS and zipf_of[word] >= OUT_OF_USE_ZIPF_CEILING * 100:
            continue
        added.setdefault(reason, []).append(word)
    if added:
        batch = existing.setdefault(today, {})
        for reason, words in added.items():
            batch[reason] = sorted(set(batch.get(reason, [])) | set(words))
    DERIVED_REJECTIONS_PATH.write_text(
        json.dumps(existing, separators=(",", ":"), sort_keys=True)
    )
    count = sum(len(words) for words in added.values())
    return count, len(judged) + count


def write_rejection_metadata(metadata: dict[str, str]) -> None:
    """Store each reason's sorted words once, instead of repeating reason strings."""
    grouped: dict[str, list[str]] = {}
    for word, reason in metadata.items():
        grouped.setdefault(reason, []).append(word)
    for words in grouped.values():
        words.sort()
    (OUT_DIR / "rejection-metadata.json").write_text(json.dumps(grouped, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Ick's dictionary and rarity data.")
    parser.add_argument(
        "--word-list",
        type=Path,
        default=DEFAULT_WORD_LIST,
        help="newline-delimited source words (default: macOS system dictionary)",
    )
    parser.add_argument(
        "--esdb-db",
        type=Path,
        help="optional ESDB SQLite database used to generate rejection metadata",
    )
    parser.add_argument(
        "--refresh-rarity",
        action="store_true",
        help="recompute rarity.json over the existing dictionary.json via the "
        "frequency waterfall, without rebuilding the curated word list",
    )
    parser.add_argument(
        "--metadata-only",
        action="store_true",
        help="refresh rejection metadata from --esdb-db without regenerating dictionary data",
    )
    parser.add_argument(
        "--refresh-rejections",
        action="store_true",
        help="re-date the derived rejections (src/data/derived-rejections.json) from "
        "Wiktionary's reasons and the existing dictionary, without regenerating "
        "anything else. Needs no ESDB database.",
    )
    parser.add_argument(
        "--since",
        default=(date.today() + timedelta(days=1)).isoformat(),
        help="the date newly recorded rejections take effect (default: tomorrow, so a "
        "puzzle already in play never loses a word mid-game)",
    )
    args = parser.parse_args()
    if args.refresh_rejections:
        dictionary = json.loads((OUT_DIR / "dictionary.json").read_text())
        zipf_hundredths = json.loads((OUT_DIR / "rarity.json").read_text())["zipfHundredths"]
        added, total = write_derived_rejections(
            load_wiktionary_reasons(), dictionary, zipf_hundredths, args.since
        )
        print(f"Wrote {DERIVED_REJECTIONS_PATH} (+{added} from {args.since}, {total} total)")
        return
    if args.refresh_rarity:
        refresh_rarity()
        return
    if args.metadata_only:
        if not args.esdb_db:
            parser.error("--metadata-only requires --esdb-db")
        dictionary = set(json.loads((OUT_DIR / "dictionary.json").read_text()))
        classification = merge_reasons(esdb_classification(args.esdb_db), load_wiktionary_reasons())
        metadata = rejection_metadata(classification, dictionary)
        write_rejection_metadata(metadata)
        print(f"Wrote {OUT_DIR / 'rejection-metadata.json'} ({len(metadata)} explanations)")
        return

    try:
        from wordfreq import zipf_frequency
    except ModuleNotFoundError:
        sys.exit("wordfreq is required; install it with: pip3 install --user wordfreq")
    if not args.esdb_db:
        parser.error("--esdb-db is required when regenerating dictionary data")
    word_list = args.word_list
    if not word_list.exists():
        sys.exit(f"Word list not found at {word_list}")

    blocklist = load_blocklist()
    print(f"Loaded {len(blocklist)} blocklisted terms")

    # Merge in Wiktionary's own reasons (e.g. "misspelling") -- ESDB never emits
    # those, so relying on ESDB alone here would silently let a Wiktionary-only
    # exclusion reason back into the dictionary via wiktionary_words below.
    classification = merge_reasons(esdb_classification(args.esdb_db), load_wiktionary_reasons())
    excluded = {word for word, reason in classification.items() if reason in ALWAYS_EXCLUDED_REASONS}
    # The keep-list wins here too, not just over the derived rejections. Wiktionary
    # files "Ellipsis of X" and "Clipping of X" under the same tag as a true
    # initialism, so this filter would otherwise *delete* ordinary nouns like
    # "condo", "thymus" and "seltzer" on the next full rebuild -- and deleting is
    # worse than rejecting, because the word loses its rarity entry and the puzzles
    # that accepted it stop adding up.
    excluded -= load_playable_exemptions()

    extra_words = load_extra_words()
    suggested_words = load_suggested_words()
    online_words = load_online_words()
    wiktionary_words = load_wiktionary_words()
    # Wiktionary lists lowercase spellings of names/abbreviations that SCOWL
    # excludes only by capitalization, plus its own misspelling-only entries
    # (e.g. "freind"); drop them so the supplement can't smuggle ineligible
    # words back into play.
    blocked = wiktionary_words & excluded
    wiktionary_words -= excluded
    raw_words = word_list.read_text(errors="ignore").splitlines()
    # Curated, player-suggested, and online-discovered words are separate
    # provenance lists but feed the same playable dictionary; the split only
    # records where a word came from.
    raw_words = (
        set(raw_words) | extra_words | suggested_words | online_words | wiktionary_words
    )
    print(f"Loaded {len(extra_words)} manually curated extra words")
    print(f"Loaded {len(suggested_words)} player-suggested words")
    print(f"Loaded {len(online_words)} online-discovered rare words")
    print(f"Loaded {len(wiktionary_words)} Wiktionary terms ({len(blocked)} name/abbr/misspelling excluded)")
    print(f"Read {len(raw_words)} candidate entries")

    candidates: dict[str, float] = {}
    for w in raw_words:
        wl = w.strip().lower()
        # Purely lowercase a-z only: this alone drops proper nouns (which
        # only appear capitalized in the source list), possessives and
        # contractions (apostrophes), and hyphenated compounds.
        if w != wl:
            continue
        if not WORD_RE.match(wl):
            continue
        if len(wl) < MIN_LEN:
            continue
        if wl in blocklist:
            continue
        zipf = zipf_frequency(wl, "en", wordlist="best")
        candidates[wl] = UNKNOWN_ZIPF if zipf == 0.0 else zipf

    print(f"Kept all {len(candidates)} eligible candidates ({UNKNOWN_ZIPF} Zipf fallback for unknowns)")

    # Histogram for tuning RARITY_BANDS.
    from collections import Counter

    hist = Counter(rarity_for_zipf(displayed_zipf(z)) for z in candidates.values())
    for _, label in RARITY_BANDS:
        print(f"  {label:16s} {hist.get(label, 0)}")

    dictionary = sorted(candidates.keys())

    # rarity.json is index-aligned with dictionary.json (same sort order)
    # rather than keyed by word again -- repeating every word as a JSON
    # object key doubled the payload size for no benefit, since the app
    # already has the word list from dictionary.json.
    # NOTE: this full rebuild floors unknown-frequency words flat (UNKNOWN_ZIPF)
    # instead of applying the Norvig/Google Books waterfall -- run
    # --refresh-rarity afterward to grade the deep tail. Emitted in the same
    # hundredths format the app expects (see refresh_rarity).
    zipf_hundredths = [round(candidates[w] * 100) for w in dictionary]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "dictionary.json").write_text(dump_word_list(dictionary))
    write_rarity(zipf_hundredths)
    # Enrich the rejection messages with Wiktextract's reasons (obsolete /
    # archaic / dated / proper-noun / abbreviation). rejection_metadata drops any
    # word that is actually playable, so this only ever adds a message for a word
    # that was already excluded -- it never removes a word from the dictionary.
    combined_reasons = merge_reasons(classification, load_wiktionary_reasons())
    metadata = rejection_metadata(combined_reasons, set(dictionary))
    write_rejection_metadata(metadata)
    # Classified words that survived into the dictionary are recorded rather than
    # removed, so they stay scoreable for the puzzles that already accepted them.
    derived_added, derived_total = write_derived_rejections(
        combined_reasons, dictionary, zipf_hundredths, args.since
    )
    print(f"Wrote {OUT_DIR / 'dictionary.json'} ({len(dictionary)} words)")
    print(f"Wrote {OUT_DIR / 'rarity.json'} ({len(dictionary)} entries, index-aligned)")
    print(f"Wrote {OUT_DIR / 'rejection-metadata.json'} ({len(metadata)} explanations)")
    print(
        f"Wrote {DERIVED_REJECTIONS_PATH} (+{derived_added} from {args.since}, "
        f"{derived_total} derived rejections)"
    )


if __name__ == "__main__":
    main()
