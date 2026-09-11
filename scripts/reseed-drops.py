#!/usr/bin/env python3
"""
Deals the first 43 published drops a second time, out in the unplayed tail.

Puzzles #1-#43 (2026-07-01 through 2026-08-12) ran before anyone was watching:
analytics_events only starts on 2026-08-19, and every submission recorded
against those days came from one or two people walking the archive afterwards
-- 2 to 25 answers each, against 25-200 for the days from #44 on. Those drops
were published, but they were never really played, so they are put back into
the rotation rather than spent.

Two exceptions stay out:
  - STR was already re-seeded once (seededDrops) and ran again as #44, with a
    real day's play behind it.
  - ING, RE, IVE and ER are affixes. scripts/../drops.json parks that whole
    class in affixDrops because bolting the drop onto any word answers the
    puzzle; the four here kept their published days only because the rule
    arrived after they were dealt. Dealing them again would undo that.

The seven with the most archive traffic -- #1 AT, #13 AS and #39-#43 OM, EX,
SP, RT, END -- go far out in the rotation instead of into the coming months,
since they are the ones a returning player is likeliest to have seen.

Run:
    python3 scripts/reseed-drops.py 2026-09-15

The date is the first day allowed to change; every earlier day keeps its drop.
Insertion only: no scheduled drop is dropped, each one after an insertion point
simply moves a day later. Follow this with

    python3 scripts/reorder-drops.py <same date>

which settles the re-seeded drops against their new neighbours.
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"

# Already re-dealt with a real audience, or parked by the affix rule.
SKIP = {"STR": "already re-seeded as #44", "ING": "affix", "RE": "affix",
        "IVE": "affix", "ER": "affix"}

# The archive days that drew more than a token visit (>= 10 submissions).
AIRED = {"AT", "AS", "OM", "EX", "SP", "RT", "END"}

# Day offsets from the first changeable day, in the pre-insertion array.
COLD_FIRST, COLD_LAST = 2, 250     # the unseen drops: the coming ~8 months
WARM_FIRST, WARM_LAST = 470, 890   # the aired ones: the back half of the rotation
NUDGE = 4  # how far a drop may slide to avoid two same-length days in a row


def spread(count: int, first: int, last: int) -> list[int]:
    if count == 1:
        return [(first + last) // 2]
    step = (last - first) / (count - 1)
    return [round(first + step * i) for i in range(count)]


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: reseed-drops.py YYYY-MM-DD  (first date allowed to change)")
    from_date = date.fromisoformat(sys.argv[1])

    path = DATA / "drops.json"
    data = json.loads(path.read_text())
    epoch = date.fromisoformat(data["epoch"])
    drops = data["drops"]
    start = (from_date - epoch).days
    if not (len(data["lockedDrops"]) <= start < len(drops)):
        sys.exit(f"{from_date} is index {start}; must be inside the unlocked tail")

    reseed = [d for d in data["lockedDrops"] if d not in SKIP]
    cold = [d for d in reseed if d not in AIRED]
    warm = [d for d in reseed if d in AIRED]

    targets: dict[int, str] = {}
    for drop, offset in list(zip(cold, spread(len(cold), COLD_FIRST, COLD_LAST))) + \
                        list(zip(warm, spread(len(warm), WARM_FIRST, WARM_LAST))):
        pos = start + offset
        # Keep the 2/3-letter cadence readable: prefer a slot whose neighbours
        # are not the same length as the drop being inserted.
        for delta in [0] + [s * k for k in range(1, NUDGE + 1) for s in (1, -1)]:
            p = pos + delta
            if p in targets or not (start <= p < len(drops)):
                continue
            if len(drops[p - 1]) != len(drop) != len(drops[p]):
                pos = p
                break
        while pos in targets:
            pos += 1
        targets[pos] = drop

    out: list[str] = []
    for i, drop in enumerate(drops):
        if i in targets:
            out.append(targets[i])
        out.append(drop)

    assert len(out) == len(drops) + len(reseed)
    assert out[:start] == drops[:start]

    data["seededDrops"] = sorted(set(data["seededDrops"]) | set(reseed))
    data["drops"] = out
    path.write_text(json.dumps(data, indent=2) + "\n")

    for pos in sorted(targets):
        drop = targets[pos]
        day = epoch + timedelta(days=pos + sum(1 for p in targets if p < pos))
        print(f"  {drop:4s} {'(aired)' if drop in AIRED else '       '} -> {day}")
    print(f"{len(reseed)} drops re-seeded; rotation is now {len(out)} days")
    for drop, why in SKIP.items():
        print(f"  held back: {drop} ({why})")


if __name__ == "__main__":
    main()
