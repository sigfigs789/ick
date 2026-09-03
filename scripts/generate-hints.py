#!/usr/bin/env python3
"""Assign one hint to every drop in the rotation.

A hint teaches a way to look for words, not a word, so the copy lives in
`src/data/hint-copy.json` and this script only decides *which* hint each drop
gets. The output is `src/data/hints.json`: drop -> hint key.

Two kinds of key:

  "middle" / "end" / "start"
      A claim about where the rarest words put the drop. The copy states it flat
      out, so the claim has to be both true and worth acting on. True means the
      rare band concentrates there (>= CONCENTRATION). Worth acting on means it
      concentrates there *more than the common words do* (by >= MARGIN): 97% of
      the rare words containing "IEN" bury it in the middle, but so do 96% of
      the common ones and 98% of every word in the dictionary, so telling a
      player that describes English rather than the puzzle.
  "walk" / "room" / "who" / "sound" / "second"
      A technique, true on any drop. For the drops whose rare words have no
      positional tendency worth stating. Ordered by a hash of the drop so a
      given drop always shows the same hint -- stable across the 1055-day cycle,
      varied from one day to the next.

Every candidate is checked for leaking an answer first. A hint may name common
words -- "a kitchen, a hospital" costs nothing, because a common word scores
badly -- but if one of those words happens to contain *this* drop and is rare
enough to be worth submitting, the hint would be handing over an answer. That
rules the candidate out for that drop, and a drop with no clean candidate gets
no hint at all, which is honest where generic filler would not be.

The copy is read rather than duplicated here on purpose: the runtime renders
from the same file, so the two cannot drift.

Rarity here is raw Zipf, not the folded score the game displays. The two
disagree (see docs/hints-draft.md), and raw Zipf is the right measure for this
question: it asks where genuinely uncommon English words put these letters, not
how the scorer treats a particular form.
"""

import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"

# The rare band: attested, uncommon, and still a word a player might know.
RARE_LO, RARE_HI = 2.4, 3.2
# Below this share of the rare band, the drop has no positional tendency at all.
CONCENTRATION = 65
# And below this lead over the common words, the tendency is not the rare words'
# -- it belongs to every word with these letters, so it separates nothing.
MARGIN = 10
# A word this common scores badly, so naming it gives nothing away.
COMMON_FLOOR = 4.0
# The techniques, for drops with no positional claim to make.
TECHNIQUES = ["walk", "room", "who", "sound", "second"]

WORD_RE = re.compile(r"[a-z]{4,}")


def main() -> None:
    words = json.loads((DATA / "dictionary.json").read_text())
    zipf_hundredths = json.loads((DATA / "rarity.json").read_text())["zipfHundredths"]
    rejections = json.loads((DATA / "word-rejections.json").read_text())
    rejected = set(rejections if isinstance(rejections, list) else rejections.keys())
    zipf = {w: zipf_hundredths[i] / 100 for i, w in enumerate(words)}
    copy = json.loads((DATA / "hint-copy.json").read_text())
    drops = sorted(set(json.loads((DATA / "drops.json").read_text())["drops"]))

    def leaks(key: str, drop: str) -> bool:
        """True if this hint would name a word worth submitting for `drop`."""
        text = copy[key].replace("{drop}", "")
        needle = drop.lower()
        for token in WORD_RE.findall(text.lower()):
            if needle not in token or token not in zipf:
                continue
            if zipf[token] < COMMON_FLOOR:
                return True
        return False

    hints: dict[str, str] = {}
    counts: Counter[str] = Counter()
    skipped: list[str] = []
    for drop in drops:
        needle = drop.lower()
        rare: Counter[str] = Counter()
        common: Counter[str] = Counter()
        for word in words:
            if needle not in word or word == needle or word in rejected:
                continue
            if len(word) < 4:
                continue
            score = zipf[word]
            i = word.index(needle)
            if i == 0:
                where = "start"
            elif i + len(needle) == len(word):
                where = "end"
            else:
                where = "middle"
            if RARE_LO <= score <= RARE_HI:
                rare[where] += 1
            elif score >= COMMON_FLOOR:
                common[where] += 1

        candidates: list[str] = []
        n_rare, n_common = sum(rare.values()), sum(common.values())
        if n_rare and n_common:
            where, n = rare.most_common(1)[0]
            share = 100 * n / n_rare
            common_share = 100 * common[where] / n_common
            if share >= CONCENTRATION and share - common_share >= MARGIN:
                candidates.append(where)
        # Stable per drop rather than random: the same drop should teach the
        # same thing every time it comes round.
        offset = hashlib.sha256(drop.encode()).digest()[0]
        candidates += [TECHNIQUES[(offset + i) % len(TECHNIQUES)] for i in range(len(TECHNIQUES))]

        chosen = next((k for k in candidates if not leaks(k, drop)), None)
        if chosen is None:
            skipped.append(drop)
            continue
        hints[drop] = chosen
        counts[chosen] += 1

    out = DATA / "hints.json"
    out.write_text(json.dumps(hints, indent=1, sort_keys=True) + "\n")
    print(f"wrote {len(hints)} hints to {out.relative_to(ROOT)}")
    for key, n in counts.most_common():
        print(f"  {key:8s} {n:5d}")
    if skipped:
        print(f"  no clean hint ({len(skipped)}): {' '.join(skipped)}")


if __name__ == "__main__":
    main()
