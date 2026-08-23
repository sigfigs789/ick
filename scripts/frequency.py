#!/usr/bin/env python3
"""Shared frequency waterfall: wordfreq -> Norvig -> Google Books -> Datamuse.

A word's rarity comes from the first corpus that attests it: wordfreq's measured
Zipf where it has one, else a Zipf estimated from Norvig's Google Web 1T counts,
else one from Google Books (calibrated onto the Norvig scale), else a Zipf
Datamuse reported for a word the bulk corpora miss entirely, else nothing -- no
source attests the word.

The Datamuse tier is last because it is not a corpus we hold: it is a per-word
lookup, recorded by hand in datamuse-zipf.txt for words graduating out of the
live-lookup queue. Its purpose is fidelity, not coverage -- without it a word the
live endpoint scored from a measured frequency would lose that score the moment
it entered the curated dictionary and fall to the unattested sentinel.

Both generate-data.py (scoring the whole dictionary) and manage-extra-word.py
(deciding whether a single word has any rarity score at all) import this so the
"does it have a Zipf" question is answered the same way in both places.

These count lists are generation-time inputs only; they never ship to the
browser.
"""
import math
import re
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Norvig's Google Web 1T unigram counts (norvig.com/ngrams/count_1w.txt) and
# Google Books English 1-grams (v3 20200217), pre-filtered to our words. Both
# are tab-separated `word<TAB>count` lists.
NORVIG_COUNTS_PATH = ROOT / "scripts" / "norvig-count-1w.txt"
GOOGLE_BOOKS_COUNTS_PATH = ROOT / "scripts" / "google-books-counts.txt"
# Per-word Zipfs Datamuse attested, recorded by hand: `word<TAB>zipf`, already on
# the Zipf scale rather than a count (see the file's own header).
DATAMUSE_ZIPF_PATH = ROOT / "scripts" / "datamuse-zipf.txt"

WORD_RE = re.compile(r"^[a-z]+$")


def bound_base_candidates(word: str) -> list[str]:
    """Base spellings for the two *bound* derivational suffixes whose base is
    unambiguous: -ization/-isation is the noun of an -ize/-ise verb, and
    -ability/-ibility the noun of an -able/-ible adjective. Opaque suffixes like
    -ment and -ism are excluded on purpose -- they collapse onto unrelated real
    words ("battlement" -> "battle"), which a spelling-only rule can't detect.
    Mirrors boundBaseCandidates() in src/game/stem.ts.
    """
    candidates: list[str] = []

    def add(base: str) -> None:
        if len(base) >= 5 and base != word and base not in candidates:
            candidates.append(base)

    if len(word) > 8:
        if word.endswith("ization"):
            add(word[:-7] + "ize")
        if word.endswith("isation"):
            add(word[:-7] + "ise")
        if word.endswith("ability"):
            add(word[:-7] + "able")
        if word.endswith("ibility"):
            add(word[:-7] + "ible")
    return candidates


def load_counts(path: Path) -> dict[str, int]:
    """Load a `word<TAB>count` frequency list, keeping pure a-z tokens."""
    counts: dict[str, int] = {}
    if not path.exists():
        return counts
    for line in path.read_text(errors="ignore").splitlines():
        word, _, count = line.partition("\t")
        word = word.strip().lower()
        if not count or not WORD_RE.match(word):
            continue
        try:
            counts[word] = counts.get(word, 0) + int(count)
        except ValueError:
            continue
    return counts


def load_zipfs(path: Path) -> dict[str, float]:
    """Load a `word<TAB>zipf` list -- Zipfs already on the scale, not counts."""
    zipfs: dict[str, float] = {}
    if not path.exists():
        return zipfs
    for line in path.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        word, _, value = line.partition("\t")
        word = word.strip().lower()
        if not value or not WORD_RE.match(word):
            continue
        try:
            zipfs[word] = float(value)
        except ValueError:
            continue
    return zipfs


class FrequencyWaterfall:
    """wordfreq -> Norvig -> Google Books -> Datamuse Zipf lookup for one word."""

    def __init__(
        self,
        norvig_path: Path = NORVIG_COUNTS_PATH,
        google_path: Path = GOOGLE_BOOKS_COUNTS_PATH,
        datamuse_path: Path = DATAMUSE_ZIPF_PATH,
    ) -> None:
        self.datamuse = load_zipfs(datamuse_path)
        self.norvig = load_counts(norvig_path)
        self.norvig_log_total = (
            math.log10(sum(self.norvig.values())) if self.norvig else None
        )
        self.google = load_counts(google_path)
        # Anchor Google Books to the Norvig scale: pick the offset that makes the
        # two agree (in the median) on the words they both contain.
        overlap = [
            math.log10(self.google[w]) - self.norvig_zipf(w)
            for w in self.google
            if self.norvig_zipf(w) is not None
        ]
        self.google_offset = statistics.median(overlap) if overlap else 0.0

    def norvig_zipf(self, word: str):
        count = self.norvig.get(word)
        if not count or self.norvig_log_total is None:
            return None
        return math.log10(count) - self.norvig_log_total + 9

    def google_zipf(self, word: str):
        count = self.google.get(word)
        if not count:
            return None
        return math.log10(count) - self.google_offset

    def _attested_zipf(self, word: str):
        """Direct waterfall Zipf: wordfreq, else Norvig, else Google Books, else
        the hand-recorded Datamuse value -- which is consulted last, so it can
        only ever fill a gap and never override a measurement."""
        from wordfreq import zipf_frequency

        wf = zipf_frequency(word, "en", wordlist="best")
        if wf > 0:
            return wf
        for candidate in (
            self.norvig_zipf(word),
            self.google_zipf(word),
            self.datamuse.get(word),
        ):
            if candidate is not None:
                return candidate
        return None

    def zipf(self, word: str, *, include_bound: bool = False):
        """Waterfall Zipf for a word, or None when no source attests it.

        wordfreq where measured, else the Norvig or Google Books estimate, else a
        recorded Datamuse value. Kept unclamped so the deepest attested words keep
        their true position.

        With ``include_bound`` a word no corpus attests directly falls back to its
        bound derivational base ("aggrandization" -> "aggrandize"), inheriting its
        Zipf. Off by default so dictionary-wide scoring (generate-data.py) is
        unchanged; the add-word gate opts in so such words aren't rejected.
        """
        direct = self._attested_zipf(word)
        if direct is not None:
            return direct
        if include_bound:
            for base in bound_base_candidates(word):
                base_zipf = self._attested_zipf(base)
                if base_zipf is not None:
                    return base_zipf
        return None
