#!/usr/bin/env python3
"""
Evaluates candidate 2-3 letter drops against the curated dictionary and
picks the ones with plenty of familiar (Common/Very Common) matches, per the
"avoid drops so hard only obscure words work" requirement.

Run:
    python3 scripts/select-drops.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "data"

# A floor on how much a drop can offer, not just a sanity check. The old
# 25/8 pair admitted drops like DRE (352 playable words, 38 familiar) into the
# daily calendar, where five guesses leave no rare upside to reach for. These
# thresholds keep ~620 of the ~1050 drops that used to qualify: a shorter
# rotation, but no dead days in it.
MIN_TOTAL_MATCHES = 100
MIN_FAMILIAR_MATCHES = 15  # Very Common + Common
MIN_FAMILIAR_ZIPF_HUNDREDTHS = 420  # an absolute familiarity floor, not a band edge

# Hand-picked candidate pool: digraphs/trigraphs that are common English
# letter clusters (blends, common syllables) rather than an exhaustive
# brute-force of all 26^2 / 26^3 combinations, which would surface mostly
# unusable drops.
CANDIDATES_2 = [
    "OU", "TH", "ER", "IN", "ON", "AN", "EN", "AR", "OR", "AT", "ST", "RE",
    "LE", "TI", "ES", "LY", "CK", "SH", "CH", "GR", "PL", "TR", "SP", "BL",
    "CR", "FR", "DR", "PR", "SC", "SW", "SN", "SM", "SL", "GL", "CL", "FL",
    "WI", "WA", "NE", "NT", "ND", "NG", "MP", "MB", "NK", "CT", "PT", "RD",
    "RT", "RN", "RM", "RK", "RG", "LD", "LK", "LT", "LM", "LF", "IT", "IC",
    "ID", "IF", "IG", "IL", "IM", "IP", "IS", "IV", "IX", "OL", "OM", "ON",
    "OP", "OT", "OW", "OX", "AB", "AC", "AD", "AG", "AL", "AM", "AP", "AS",
    "AV", "AW", "AX", "AY", "EA", "EC", "ED", "EF", "EL", "EM", "EP", "ET",
    "EV", "EW", "EX", "UG", "UM", "UN", "UP", "US", "UT", "OO", "EE", "AI",
]

CANDIDATES_3 = [
    "STR", "SPR", "SCR", "SPL", "THR", "SHR", "SQU", "ING", "TER", "TION",
    "MENT", "OUS", "IVE", "EST", "ATE", "ITY", "OUN", "OUT", "OUR", "OUS",
    "AND", "END", "IND", "OND", "UND", "ANT", "ENT", "INT", "ONT", "UNT",
    "ARD", "ORD", "URD", "ARK", "ORK", "IRK", "URK", "ART", "ORT", "IRT",
    "URT", "ALK", "ILK", "ULK", "OLK", "ELP", "ALT", "ELT", "ILT", "OLT",
    "ULT", "AMP", "IMP", "OMP", "UMP", "EMP", "AND", "ONG", "UNG", "ANG",
    "ING", "ENG", "ANK", "INK", "ONK", "UNK", "ENK", "MPL", "MBL", "NKL",
    "GHT", "TCH", "DGE", "CKL", "PLE", "BLE", "KLE", "GLE", "TLE", "DLE",
]


def contains_drop(word: str, drop: str) -> bool:
    return drop in word


def main() -> None:
    dictionary = json.loads((DATA_DIR / "dictionary.json").read_text())
    rarity = json.loads((DATA_DIR / "rarity.json").read_text())
    zipf_hundredths = rarity["zipfHundredths"]
    word_indexes = {word: i for i, word in enumerate(dictionary)}

    results = []
    candidates = {
        candidate
        for candidate in CANDIDATES_2 + CANDIDATES_3
        if len(candidate) in (2, 3)
    }
    # Consider every 2- and 3-letter sequence present in the dictionary;
    # the thresholds below retain only drops with enough approachable answers.
    for word in dictionary:
        for length in (2, 3):
            candidates.update(word[i:i + length].upper() for i in range(len(word) - length + 1))

    for drop in sorted(candidates, key=lambda f: (len(f), f)):
        f = drop.lower()
        match_indexes = [i for i, word in enumerate(dictionary) if f in word]
        matches = [dictionary[i] for i in match_indexes]
        familiar = [dictionary[i] for i in match_indexes
                    if zipf_hundredths[i] >= MIN_FAMILIAR_ZIPF_HUNDREDTHS]
        if len(matches) >= MIN_TOTAL_MATCHES and len(familiar) >= MIN_FAMILIAR_MATCHES:
            results.append({
                "drop": drop.upper(),
                "totalMatches": len(matches),
                "familiarMatches": len(familiar),
                "sampleFamiliar": sorted(
                    familiar,
                    key=lambda word: -zipf_hundredths[word_indexes[word]],
                )[:6],
            })

    results.sort(key=lambda r: (len(r["drop"]), -r["familiarMatches"]))

    print(f"{len(results)} drops passed thresholds "
          f"(total>={MIN_TOTAL_MATCHES}, familiar>={MIN_FAMILIAR_MATCHES})\n")
    for r in results:
        print(f"  {r['drop']:5s} total={r['totalMatches']:4d} "
              f"familiar={r['familiarMatches']:4d}  e.g. {', '.join(r['sampleFamiliar'])}")

    out_path = ROOT / "scripts" / "drop-candidates.json"
    out_path.write_text(json.dumps(results, indent=2))
    print(f"\nWrote {out_path}")

    drops_path = DATA_DIR / "drops.json"
    existing = json.loads(drops_path.read_text())
    locked_drops = existing.get("lockedDrops", [])
    seeded_drops = existing.get("seededDrops", [])
    # Held out of the rotation, not retired: these are parked for a possible
    # challenge mode, so they must never be re-seeded into the daily list.
    challenging_drops = existing.get("challengingDrops", [])
    # Half the "hard" tier, parked to halve how often a hard day comes up.
    hard_drops = existing.get("hardDrops", [])
    # Pulled from the calendar by hand, for reasons the thresholds here cannot
    # see; kept listed so a regeneration never re-seeds them.
    retired_drops = existing.get("retiredDrops", [])
    locked_set = set(
        locked_drops + seeded_drops + challenging_drops + hard_drops + retired_drops
    )
    two_letter = [
        result for result in results
        if len(result["drop"]) == 2 and result["drop"] not in locked_set
    ]
    three_letter = [
        result for result in results
        if len(result["drop"]) == 3 and result["drop"] not in locked_set
    ]
    remaining_count = len(two_letter) + len(three_letter)
    two_positions = {
        int((index + 0.5) * remaining_count / len(two_letter))
        for index in range(len(two_letter))
    }
    ordered_drops = list(locked_drops + seeded_drops)
    two_index = three_index = 0
    for position in range(remaining_count):
        if position in two_positions:
            ordered_drops.append(two_letter[two_index]["drop"])
            two_index += 1
        else:
            ordered_drops.append(three_letter[three_index]["drop"])
            three_index += 1
    drops_path.write_text(json.dumps({
        "epoch": existing["epoch"],
        "lockedDrops": locked_drops,
        "seededDrops": seeded_drops,
        "challengingDrops": challenging_drops,
        "hardDrops": hard_drops,
        "retiredDrops": retired_drops,
        "drops": ordered_drops,
    }, indent=2) + "\n")
    print(f"Wrote {drops_path}")


if __name__ == "__main__":
    main()
