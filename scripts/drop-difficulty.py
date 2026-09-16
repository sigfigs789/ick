#!/usr/bin/env python3
"""
Rates every drop by the scoring it actually offers: how many playable words
containing it land Rare or better.

Three counts per drop, because the game now has two scoring systems in play and
the difference between them is not a rounding error:

  - `rarePlus`: the fold on, which is every ordinary day. An inflection is
    capped at its base, so "abacuses" scores as "abacus" and is not an option.
  - `freeformRarePlus`: the fold off, which is freeform week (FREEFORM_START in
    src/game/dictionary.ts). Every word scores on its own measured frequency,
    so the capped inflections come back as bankable answers.
  - `freeformUnattested`: the words behind that drop carrying the unattested
    sentinel (see `unattestedZipf`), each of which displays a flat 10.00 /
    Legend when the fold is off.

The third is the one that decides whether a freeform day is worth playing. The
fold is what normally rescues a sentinel word -- `isUnattestedZipf` is read
*after* adjustment, so a sentinel with an attested base scores on its base's
real frequency. Without the fold nothing rescues it: 8,789 playable words carry
the sentinel and only 414 of them survive the fold, so freeform week restores
roughly 21x as many free perfect scores.

That lands very unevenly across drops. The counts are dominated by one
structural family -- the drops catching "-ness" and "-esses", where unattested
formations are effectively unlimited -- and NES is the clearest case: 3 free
10.00s with the fold on, 3,007 without it. A drop can be perfectly well
behaved on an ordinary day and hand out the whole scoreboard inside the window,
which is why this is measured per drop rather than reasoned about per word.

A caveat that belongs with the number: a missing Zipf is a gap in the corpora,
not a property of the word. This measure is a fair way to schedule *around* the
gap for a known window; it is not a verdict on the words themselves, and it
will move as the corpora improve.

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

Writes scripts/drop-difficulty.json: all three counts per drop named anywhere in
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

    # The sentinel is the rarest value in the data, assigned to every word no
    # corpus attests. Read off the data rather than hardcoded, so it follows a
    # regeneration (see src/game/dictionary.ts, which derives MIN_ZIPF the same
    # way).
    sentinel = min(hundredths) / 100

    counts = {drop: 0 for drop in wanted}
    freeform_counts = {drop: 0 for drop in wanted}
    unattested_counts = {drop: 0 for drop in wanted}
    scored = 0
    freeform_scored = 0
    unattested_scored = 0
    for word in dictionary:
        if word in rejections:
            continue
        raw = round(zipf_at(word), 2)
        # The fold off is the freeform reading, and it is the cheaper of the two
        # to reach -- a word Rare+ under the fold is Rare+ without it, never the
        # other way round -- so it gates the folded count.
        if scoring.rarity_label(raw, max_zipf) not in RARE_OR_BETTER:
            continue
        freeform_scored += 1
        grams = {word[j:j + n].upper()
                 for n in (2, 3) for j in range(len(word) - n + 1)}
        hits = grams & wanted
        for gram in hits:
            freeform_counts[gram] += 1
        if raw == sentinel:
            unattested_scored += 1
            for gram in hits:
                unattested_counts[gram] += 1
        zipf = round(scoring.adjusted_zipf(word, index, zipf_at), 2)
        if scoring.rarity_label(zipf, max_zipf) not in RARE_OR_BETTER:
            continue
        scored += 1
        for gram in hits:
            counts[gram] += 1

    OUT.write_text(json.dumps({
        "measure": "playable words containing the drop that score Rare or better "
                   "(displayed score >= 7.0) after the scoring fold",
        "freeformMeasure": "the same count with the fold off, which is how "
                           "freeform week scores (see FREEFORM_START)",
        "freeformUnattestedMeasure": "playable words containing the drop that "
                                     "carry the unattested sentinel Zipf, each "
                                     "a flat 10.00 / Legend with the fold off",
        "source": "scripts/drop-difficulty.py",
        "wordsCounted": scored,
        "freeformWordsCounted": freeform_scored,
        "freeformUnattestedWordsCounted": unattested_scored,
        "rarePlus": dict(sorted(counts.items(), key=lambda kv: (kv[1], kv[0]))),
        "freeformRarePlus": dict(
            sorted(freeform_counts.items(), key=lambda kv: (kv[1], kv[0]))
        ),
        "freeformUnattested": dict(
            sorted(unattested_counts.items(), key=lambda kv: (kv[1], kv[0]))
        ),
    }, indent=2) + "\n")

    ranked = sorted(counts.items(), key=lambda kv: kv[1])
    print(f"{scored} words score Rare or better ({freeform_scored} with the fold "
          f"off); rated {len(counts)} drops")
    print("  hardest:", ", ".join(f"{d} {n}" for d, n in ranked[:8]))
    print("  easiest:", ", ".join(f"{d} {n}" for d, n in ranked[-8:]))
    free_ranked = sorted(unattested_counts.items(), key=lambda kv: -kv[1])
    print(f"{unattested_scored} of them are unattested -- a flat 10.00 each "
          f"inside freeform week")
    print("  most generous:", ", ".join(f"{d} {n}" for d, n in free_ranked[:8]))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
