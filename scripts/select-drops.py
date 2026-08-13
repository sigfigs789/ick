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

MIN_TOTAL_MATCHES = 25
MIN_FAMILIAR_MATCHES = 8  # Very Common + Common
MIN_FAMILIAR_ZIPF_TENTHS = 42  # Common, Very Common, or Quotidian

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
    zipf_tenths = rarity["zipfTenths"]
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
        familiar = [dictionary[i] for i in match_indexes if zipf_tenths[i] >= MIN_FAMILIAR_ZIPF_TENTHS]
        if len(matches) >= MIN_TOTAL_MATCHES and len(familiar) >= MIN_FAMILIAR_MATCHES:
            results.append({
                "drop": drop.upper(),
                "totalMatches": len(matches),
                "familiarMatches": len(familiar),
                "sampleFamiliar": sorted(
                    familiar,
                    key=lambda word: -zipf_tenths[word_indexes[word]],
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
    drops_path.write_text(json.dumps({"epoch": existing["epoch"], "drops": [r["drop"] for r in results]}, indent=2) + "\n")
    print(f"Wrote {drops_path}")


if __name__ == "__main__":
    main()
