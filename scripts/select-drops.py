#!/usr/bin/env python3
"""
Evaluates candidate 2-3 letter drops against the curated dictionary and
picks the ones with plenty of familiar (Common/Very Common) matches, per the
"avoid drops so hard only obscure words work" requirement.

Run:
    python3 scripts/select-drops.py
"""
import json
import string
from itertools import product
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "data"

MIN_TOTAL_MATCHES = 25
MIN_FAMILIAR_MATCHES = 8  # Very Common + Common
FAMILIAR_RARITIES = {"Very Common", "Common"}

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

    results = []
    for drop in sorted(set(CANDIDATES_2 + CANDIDATES_3), key=lambda f: (len(f), f)):
        f = drop.lower()
        matches = [w for w in dictionary if f in w]
        familiar = [w for w in matches if rarity[w]["rarity"] in FAMILIAR_RARITIES]
        if len(matches) >= MIN_TOTAL_MATCHES and len(familiar) >= MIN_FAMILIAR_MATCHES:
            results.append({
                "drop": drop.upper(),
                "totalMatches": len(matches),
                "familiarMatches": len(familiar),
                "sampleFamiliar": sorted(familiar, key=lambda w: -rarity[w]["zipf"])[:6],
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


if __name__ == "__main__":
    main()
