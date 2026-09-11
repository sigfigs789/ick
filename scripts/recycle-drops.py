#!/usr/bin/env python3
"""
Returns the drops dealt before the game had players to the unplayed tail, so
their answer-rich boards get a second outing in front of an actual audience.

Run:
    python3 scripts/recycle-drops.py 2026-09-11
    python3 scripts/reorder-drops.py 2026-09-11   # always follow with this

The date is the first day allowed to change; every earlier day keeps its drop.
Played days are never touched -- a recycled drop keeps its original day in the
archive and gains a *second* occurrence later in the rotation, which is why the
rotation grows by one day per drop recycled.

Which drops qualify is a judgement call made once and recorded in
`recycledDrops`, not recomputed here: the game's telemetry only starts on
2026-08-20, so "nobody played this" is a reading of the evidence (every
accepted answer against those days arrived in a single archive sweep on
2026-08-31) rather than something the data states outright. RECYCLED below is
that reading, frozen.

Deliberately excluded, though they sit in the same pre-launch stretch:
  - STR, which had a real outing on 2026-08-13 -- it was seeded a second time
    on day 44, back when day 44 was still in the future.
  - ING, RE and IVE, which are affixes. Bolt an affix onto any word and you
    have an answer, so the class is parked in `affixDrops`; these three are
    exempt only because they were already dealt (see drop.test.ts). Dealing
    one again on purpose is the thing that rule exists to prevent.

This script only places the drops, evenly spread so no two land near each
other. reorder-drops.py then anneals the whole tail for word-overlap variance
and tion spacing, which is what actually settles where they sit.
"""
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"

# Days 1-37 (2026-07-01 .. 2026-08-06), less the exclusions above.
RECYCLED = [
    "AT", "FL", "LT", "IG", "EA", "EP", "RM", "GHT", "EE", "EL",
    "AS", "FR", "AC", "OT", "EV", "OUT", "IT", "SM", "GR", "UG",
    "IL", "PLE", "AL", "END", "NK", "SC", "TR", "RK", "OO", "RN",
    "AW", "AP", "US",
]


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: recycle-drops.py YYYY-MM-DD  (first date allowed to change)")
    from_date = date.fromisoformat(sys.argv[1])

    drops_path = DATA / "drops.json"
    data = json.loads(drops_path.read_text())
    epoch = date.fromisoformat(data["epoch"])
    drops = data["drops"]
    cut = (from_date - epoch).days
    if not (len(data["lockedDrops"]) <= cut < len(drops)):
        sys.exit(f"{from_date} is index {cut}; must be inside the unlocked tail")

    if data.get("recycledDrops"):
        sys.exit("recycledDrops is already set; this script is a one-shot")

    played = drops[:cut]
    for drop in RECYCLED:
        if drop not in played:
            sys.exit(f"{drop} was never dealt, so there is nothing to recycle")
    parked = set(data["challengingDrops"] + data["hardDrops"]
                 + data["retiredDrops"] + data["affixDrops"])
    clash = sorted(set(RECYCLED) & parked)
    if clash:
        sys.exit(f"refusing to deal parked drops: {', '.join(clash)}")

    tail = drops[cut:]
    for drop in RECYCLED:
        if drop in tail:
            sys.exit(f"{drop} is already queued in the tail")

    # Spread them evenly through the tail rather than appending: the annealer's
    # drift term keeps a drop near where it starts, so a block dumped at the end
    # would stay at the end, and these are the richest boards in the game.
    step = (len(tail) + len(RECYCLED)) / len(RECYCLED)
    merged = list(tail)
    for offset, drop in enumerate(RECYCLED):
        merged.insert(int((offset + 0.5) * step), drop)

    assert len(merged) == len(tail) + len(RECYCLED)
    assert len(set(merged)) == len(merged), "duplicate drop in the new tail"

    data["recycledDrops"] = RECYCLED
    data["drops"] = played + merged
    drops_path.write_text(json.dumps(data, indent=2) + "\n")

    last = epoch.toordinal() + len(data["drops"]) - 1
    print(f"Recycled {len(RECYCLED)} drops into the tail from {from_date}.")
    print(f"Rotation: {len(drops)} -> {len(data['drops'])} days "
          f"(runway now ends {date.fromordinal(last)})")
    print(f"Wrote {drops_path}")
    print("\nNow run: python3 scripts/reorder-drops.py "
          f"{from_date}   # spreads them properly")


if __name__ == "__main__":
    main()
