#!/usr/bin/env python3
"""
Rates every drop by the scoring it actually offers: how many playable words
containing it land Rare or better once the fold has capped inflections at their
base.

This is the measure PR #202 sorted the difficulty tiers on -- challengingDrops
is Rare+ under 160, hardDrops 160..289 -- computed there by hand and never
committed. It lives here now so the rotation can be sorted on it and the tiers
re-cut without measuring it again.

Why Rare+ and not raw matches: a drop with thousands of words behind it is easy
only if some of them score. What a player trying to score has is the words worth
banking, and a fold-capped plural is not one of them -- "abacuses" scores as
"abacus". Counting the words that clear Rare is counting the day's real options.

The fold and the bands come from scripts/manage-extra-word.py, which mirrors
src/game/dictionary.ts; nothing is reimplemented here, so a fold change lands
in this measure as soon as that mirror is brought up to date.

Run:
    python3 scripts/drop-difficulty.py

Writes scripts/drop-difficulty.json: one Rare+ count per drop named anywhere in
drops.json (the rotation and every parked tier). Takes about a minute.
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"
OUT = ROOT / "scripts" / "drop-difficulty.json"

# Rare, Extremely Rare, Elusive and the two top ranks: everything a player would
# bank for the score rather than for the streak.
RARE_OR_BETTER = frozenset({"Rare", "Extremely Rare", "Elusive", "Mythic", "Legend"})


def scoring_mirror():
    """manage-extra-word.py as a module -- the hyphen keeps it off the import path."""
    sys.path.insert(0, str(ROOT / "scripts"))  # its own `import frequency`
    spec = importlib.util.spec_from_file_location(
        "manage_extra_word", ROOT / "scripts" / "manage-extra-word.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    scoring = scoring_mirror()

    dictionary = json.loads((DATA / "dictionary.json").read_text())
    hundredths = json.loads((DATA / "rarity.json").read_text())["zipfHundredths"]
    rejections = set(json.loads((DATA / "word-rejections.json").read_text()))
    for batch in json.loads((DATA / "derived-rejections.json").read_text()).values():
        for words in batch.values():
            rejections.update(words)

    index = {word: i for i, word in enumerate(dictionary)}
    max_zipf = max(hundredths) / 100

    def zipf_at(word: str) -> float:
        return hundredths[index[word]] / 100

    drops_data = json.loads((DATA / "drops.json").read_text())
    wanted = {d for key, value in drops_data.items()
              if isinstance(value, list) for d in value}

    counts = {drop: 0 for drop in wanted}
    scored = 0
    for word in dictionary:
        if word in rejections:
            continue
        zipf = round(scoring.adjusted_zipf(word, index, zipf_at), 2)
        if scoring.rarity_label(zipf, max_zipf) not in RARE_OR_BETTER:
            continue
        scored += 1
        grams = {word[j:j + n].upper() for n in (2, 3) for j in range(len(word) - n + 1)}
        for gram in grams & wanted:
            counts[gram] += 1

    OUT.write_text(json.dumps({
        "measure": "playable words containing the drop that score Rare or better "
                   "(displayed score >= 7.0) after the scoring fold",
        "source": "scripts/drop-difficulty.py",
        "wordsCounted": scored,
        "rarePlus": dict(sorted(counts.items(), key=lambda kv: (kv[1], kv[0]))),
    }, indent=2) + "\n")

    ranked = sorted(counts.items(), key=lambda kv: kv[1])
    print(f"{scored} words score Rare or better; rated {len(counts)} drops")
    print("  hardest:", ", ".join(f"{d} {n}" for d, n in ranked[:8]))
    print("  easiest:", ", ".join(f"{d} {n}" for d, n in ranked[-8:]))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
