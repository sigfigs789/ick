#!/usr/bin/env python3
"""
Reorders the unplayed tail of the drop rotation so consecutive days feel
different: minimizes how many familiar words two nearby drops share, and
spreads the "tion"-resolving drops (ION, TIO, ATI, ONS, TAT, ...) far apart
instead of letting them clump the way the familiar-count ordering from
select-drops.py left them.

Run:
    python3 scripts/reorder-drops.py 2026-08-20

The date is the first day allowed to change; every earlier day keeps its drop
(they have already been played or are live). Pick tomorrow or later unless you
mean to change a drop players may already have seen today.

How it works:
  - Each drop's identity is the set of *familiar* playable words containing it
    (measured Zipf >= 3.0, curated rejections excluded) -- the words players
    actually reach for. Overlap between two drops is |A n B| / min(|A|, |B|).
  - A drop's "tion share" is the fraction of those words containing "tion";
    ONS counts because its familiar set is half -tions plurals.
  - Simulated annealing (fixed seed, deterministic) swaps drops within
    same-length slots -- the 2-letter/3-letter cadence never changes -- to
    minimize: overlap with the previous 3 days, plus a penalty for two
    tion-leaning drops landing within 30 days of each other, plus a tiny
    drift term that keeps drops near their original position when nothing
    forces a move. The already-played days before the cut are included as
    fixed context, so the first reordered days also steer clear of them.
"""
import json
import math
import random
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"

FAMILIAR_ZIPF_HUNDREDTHS = 300
OVERLAP_WEIGHTS = {1: 1.0, 2: 0.4, 3: 0.15}  # by day distance
TION_FLOOR = 0.10     # drops below 10% tion share don't repel each other
TION_WINDOW = 30      # days over which two tion drops repel
TION_WEIGHT = 6.0
DRIFT = 2e-5          # tie-breaker toward a drop's original position
STEPS = 400_000
T_START, T_END = 0.02, 0.0005
RESTARTS = 4          # annealing runs; the lowest-cost result wins


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: reorder-drops.py YYYY-MM-DD  (first date allowed to change)")
    from_date = date.fromisoformat(sys.argv[1])

    drops_path = DATA / "drops.json"
    drops_data = json.loads(drops_path.read_text())
    epoch = date.fromisoformat(drops_data["epoch"])
    drops = drops_data["drops"]
    sort_from = (from_date - epoch).days
    if not (len(drops_data["lockedDrops"]) <= sort_from < len(drops)):
        sys.exit(f"{from_date} is index {sort_from}; must be inside the unlocked tail")

    dictionary = json.loads((DATA / "dictionary.json").read_text())
    zipf = json.loads((DATA / "rarity.json").read_text())["zipfHundredths"]
    rejections = set(json.loads((DATA / "word-rejections.json").read_text()))

    # ngram -> bitmask over the familiar playable words
    tion_mask = 0
    masks: dict[str, int] = {}
    wid = 0
    for i, word in enumerate(dictionary):
        if word in rejections or zipf[i] < FAMILIAR_ZIPF_HUNDREDTHS:
            continue
        bit = 1 << wid
        wid += 1
        if "tion" in word:
            tion_mask |= bit
        grams = {word[j:j + n] for n in (2, 3) for j in range(len(word) - n + 1)}
        for g in grams:
            masks[g] = masks.get(g, 0) | bit

    mask_of = {d: masks.get(d.lower(), 0) for d in set(drops)}
    count_of = {d: m.bit_count() for d, m in mask_of.items()}
    tion_of = {d: ((m & tion_mask).bit_count() / c if (c := count_of[d]) else 0.0)
               for d, m in mask_of.items()}

    overlap_cache: dict[tuple[str, str], float] = {}

    def overlap(a: str, b: str) -> float:
        key = (a, b) if a <= b else (b, a)
        v = overlap_cache.get(key)
        if v is None:
            lo = min(count_of[a], count_of[b])
            v = (mask_of[a] & mask_of[b]).bit_count() / lo if lo else 0.0
            overlap_cache[key] = v
        return v

    tail = drops[sort_from:]
    n = len(tail)
    assert len(set(tail)) == n, "duplicate drop in the sortable tail"
    context = drops[sort_from - TION_WINDOW:sort_from]  # fixed, already played
    orig_index = {d: i for i, d in enumerate(tail)}

    def prev_drop(seq: list[str], j: int) -> str | None:
        if j >= 0:
            return seq[j]
        return context[j] if -j <= len(context) else None

    def local_cost(seq: list[str], i: int) -> float:
        """Cost terms where position i is the later day of the pair."""
        d = seq[i]
        c = sum(w * overlap(p, d)
                for k, w in OVERLAP_WEIGHTS.items()
                if (p := prev_drop(seq, i - k)) is not None)
        t = tion_of[d]
        if t >= TION_FLOOR:
            for k in range(1, TION_WINDOW + 1):
                p = prev_drop(seq, i - k)
                if p is not None and tion_of[p] >= TION_FLOOR:
                    c += TION_WEIGHT * t * tion_of[p] * (TION_WINDOW - k + 1) / TION_WINDOW
        return c + DRIFT * abs(orig_index[d] - i)

    def cost_around(seq: list[str], positions: tuple[int, int]) -> float:
        affected = set()
        for p in positions:
            affected.update(q for q in range(p, p + TION_WINDOW + 1) if q < n)
        return sum(local_cost(seq, i) for i in affected)

    slots_by_len = {2: [i for i, d in enumerate(tail) if len(d) == 2],
                    3: [i for i, d in enumerate(tail) if len(d) == 3]}

    def anneal(seed: int) -> list[str]:
        rng = random.Random(seed)
        seq = list(tail)
        for step in range(STEPS):
            temp = T_START * (T_END / T_START) ** (step / STEPS)
            slots = slots_by_len[2 if rng.random() < 0.4 else 3]
            i, j = rng.sample(slots, 2)
            before = cost_around(seq, (i, j))
            seq[i], seq[j] = seq[j], seq[i]
            delta = cost_around(seq, (i, j)) - before
            if delta > 0 and rng.random() >= math.exp(-delta / temp):
                seq[i], seq[j] = seq[j], seq[i]
        return seq

    base_seed = int(from_date.strftime("%Y%m%d")) * 10
    candidates = []
    for k in range(RESTARTS):
        seq = anneal(base_seed + k)
        cost = sum(local_cost(seq, i) for i in range(n))
        print(f"restart {k}: cost {cost:.3f}")
        candidates.append((cost, seq))
    seq = min(candidates)[1]

    assert sorted(seq) == sorted(tail)

    def report(t: list[str], label: str) -> None:
        full = drops[:sort_from] + t
        ovs = [overlap(full[i - 1], full[i]) for i in range(sort_from, len(full))]
        ovs.append(overlap(full[-1], full[0]))  # rotation wraps around
        tion_days = [i for i in range(sort_from, len(full)) if tion_of[full[i]] >= 0.25]
        gaps = [b - a for a, b in zip(tion_days, tion_days[1:])]
        print(f"--- {label} ---")
        print(f"  adjacent overlap: mean={sum(ovs) / len(ovs):.4f} max={max(ovs):.3f} "
              f">=30%: {sum(o >= 0.3 for o in ovs)}")
        if gaps:
            print(f"  tion-heavy days (>=25% share): {len(tion_days)}; day gaps "
                  f"min={min(gaps)} median={sorted(gaps)[len(gaps) // 2]}; "
                  f"first: {epoch + timedelta(days=tion_days[0])} ({full[tion_days[0]]})")

    report(tail, "before")
    report(seq, "after")

    drops_data["drops"] = drops[:sort_from] + seq
    drops_path.write_text(json.dumps(drops_data, indent=2) + "\n")
    print(f"Wrote {drops_path}")


if __name__ == "__main__":
    main()
