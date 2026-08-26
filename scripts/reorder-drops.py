#!/usr/bin/env python3
"""
Reorders the unplayed tail of the drop rotation so consecutive days feel
different *without* spending the rotation's rare-word depth to do it.

Run:
    python3 scripts/reorder-drops.py 2026-08-27

The date is the first day allowed to change; every earlier day keeps its drop
(they have already been played or are live). Pick tomorrow or later unless you
mean to change a drop players may already have seen today.

Why the banding exists
----------------------
select-drops.py lays the rotation out richest-first, so the calendar ramps
from deep drops down to lean ones over years. The first version of this script
annealed over the whole tail at once with only a 2e-5 drift term holding
position, which was far too weak: drops from years out got pulled into the
next few months and the ramp flattened. Over the 90 days after the 2026-08-21
cut, the median count of rare-but-findable words per day fell 583 -> 336 and
days under 200 such words went from 2 to 21. Variety was bought with depth.

So the permutation is now constrained. Each drop is assigned a calendar band
by its own depth rank (richest drops to the earliest bands), and the annealer
may only swap drops *within* a (length, band) group. Variety is bought among
drops of comparable depth; the ramp is a property of the assignment, not
something the objective has to defend.

How it works:
  - A drop's DEPTH is how many playable words it reaches in the rare-but-
    findable band (Zipf 2.0-3.0) -- rare enough to score well, common enough
    that a player actually thinks of them. This is what a high-scoring day is
    made of, so it drives the band assignment.
  - A drop's identity, for "do these two days feel the same", is two sets of
    playable words: the familiar ones (Zipf >= 3.0) players reach for first,
    and the whole scoring pool (Zipf >= 2.0) that decides the final total.
    Overlap is the mean of |A n B| / min(|A|, |B|) over both. The familiar-only
    measure the first version used was blind to two days sharing their rare
    upside.
  - Simulated annealing (fixed seed, deterministic) swaps drops within
    (length, band) groups -- the 2-letter/3-letter cadence never changes, and
    neither does the depth ramp -- to minimize: overlap with the previous 3
    days, a penalty for two tion-leaning drops landing close together, a
    penalty for two lean days back to back, plus a tiny drift term that keeps
    drops near their banded position when nothing forces a move. The already-
    played days before the cut are included as fixed context, so the first
    reordered days also steer clear of them.
"""
import json
import math
import random
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"

FAMILIAR_ZIPF_HUNDREDTHS = 300   # words players reach for first
SCORING_ZIPF_HUNDREDTHS = 200    # floor of the pool that decides a score
OVERLAP_WEIGHTS = {1: 1.0, 2: 0.4, 3: 0.15}  # by day distance

# Calendar band width, in days. Drops are assigned to bands by depth rank, and
# the annealer only reshuffles inside a band. Narrower bands hold the ramp
# tighter; wider bands give the overlap objective more room.
BAND_DAYS = 60

# The tion terms. The first version used weight 6.0 over 30 days, which
# rationed the deepest drops in the rotation (ION, TIO and ATI each reach
# 8k-10k words) to roughly one a month. Inside a band the overlap term already
# keeps the -tion families apart, so this only has to stop same-week clumping.
TION_FLOOR = 0.10     # drops below 10% tion share don't repel each other
TION_WINDOW = 12      # days over which two tion drops repel
TION_WEIGHT = 2.0

# Two lean days back to back read as a dead patch. This only bites in the
# bands that straddle the floor -- deep in the tail every drop is under it, and
# the term goes flat rather than fighting the ramp.
LEAN_DEPTH = 200      # rare-but-findable words below which a day plays thin
LEAN_WEIGHT = 0.5

DRIFT = 2e-5          # tie-breaker toward a drop's banded position
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
    # The derived rejections count too -- an unplayable word must not make a drop
    # look richer than it is.
    for batch in json.loads((DATA / "derived-rejections.json").read_text()).values():
        for words in batch.values():
            rejections.update(words)

    # ngram -> bitmasks over the playable words, one per identity band
    tion_mask = 0
    familiar_masks: dict[str, int] = {}
    scoring_masks: dict[str, int] = {}
    depth_masks: dict[str, int] = {}
    wid = 0
    for i, word in enumerate(dictionary):
        if word in rejections or zipf[i] < SCORING_ZIPF_HUNDREDTHS:
            continue
        bit = 1 << wid
        wid += 1
        familiar = zipf[i] >= FAMILIAR_ZIPF_HUNDREDTHS
        if "tion" in word:
            tion_mask |= bit
        grams = {word[j:j + n] for n in (2, 3) for j in range(len(word) - n + 1)}
        for g in grams:
            scoring_masks[g] = scoring_masks.get(g, 0) | bit
            if familiar:
                familiar_masks[g] = familiar_masks.get(g, 0) | bit
            else:
                depth_masks[g] = depth_masks.get(g, 0) | bit

    def masks_for(table: dict[str, int]) -> dict[str, int]:
        return {d: table.get(d.lower(), 0) for d in set(drops)}

    fam_of = masks_for(familiar_masks)
    score_of = masks_for(scoring_masks)
    # DEPTH: rare-but-findable words, the raw material of a high-scoring day.
    depth_of = {d: m.bit_count() for d, m in masks_for(depth_masks).items()}
    fam_count = {d: m.bit_count() for d, m in fam_of.items()}
    score_count = {d: m.bit_count() for d, m in score_of.items()}
    tion_of = {d: ((m & tion_mask).bit_count() / c if (c := score_count[d]) else 0.0)
               for d, m in score_of.items()}

    overlap_cache: dict[tuple[str, str], float] = {}

    def overlap(a: str, b: str) -> float:
        """Mean containment over the familiar set and the whole scoring pool."""
        key = (a, b) if a <= b else (b, a)
        v = overlap_cache.get(key)
        if v is None:
            total = 0.0
            for masks, counts in ((fam_of, fam_count), (score_of, score_count)):
                lo = min(counts[a], counts[b])
                total += (masks[a] & masks[b]).bit_count() / lo if lo else 0.0
            overlap_cache[key] = v = total / 2
        return v

    tail = drops[sort_from:]
    n = len(tail)
    assert len(set(tail)) == n, "duplicate drop in the sortable tail"
    context = drops[sort_from - TION_WINDOW:sort_from]  # fixed, already played

    # Rebuild the depth ramp: within each length class, the deepest drops take
    # the earliest slots of that length. The 2/3-letter cadence is fixed by
    # position and is untouched.
    slots_by_len = {length: [i for i, d in enumerate(tail) if len(d) == length]
                    for length in (2, 3)}
    ramp = list(tail)
    for length, slots in slots_by_len.items():
        by_depth = sorted((d for d in tail if len(d) == length),
                          key=lambda d: (-depth_of[d], d))
        for slot, drop in zip(slots, by_depth):
            ramp[slot] = drop
    ramp_index = {d: i for i, d in enumerate(ramp)}

    # Swap groups: same length *and* same calendar band.
    groups = [g for g in {
        (length, i // BAND_DAYS): [s for s in slots if s // BAND_DAYS == i // BAND_DAYS]
        for length, slots in slots_by_len.items()
        for i in slots
    }.values() if len(g) >= 2]
    group_weights = [len(g) for g in groups]

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
        if depth_of[d] < LEAN_DEPTH:
            p = prev_drop(seq, i - 1)
            if p is not None and depth_of[p] < LEAN_DEPTH:
                c += LEAN_WEIGHT
        return c + DRIFT * abs(ramp_index[d] - i)

    def cost_around(seq: list[str], positions: tuple[int, int]) -> float:
        affected = set()
        for p in positions:
            affected.update(q for q in range(p, p + TION_WINDOW + 1) if q < n)
        return sum(local_cost(seq, i) for i in affected)

    def anneal(seed: int) -> list[str]:
        rng = random.Random(seed)
        seq = list(ramp)
        for step in range(STEPS):
            temp = T_START * (T_END / T_START) ** (step / STEPS)
            slots = rng.choices(groups, weights=group_weights)[0]
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
        for span in (90, 180, 365):
            window = [depth_of[d] for d in t[:span]]
            if not window:
                continue
            lean = sum(1 for x in window if x < LEAN_DEPTH)
            back_to_back = sum(1 for a, b in zip(window, window[1:])
                               if a < LEAN_DEPTH and b < LEAN_DEPTH)
            print(f"  next {span:3d} days: median depth={sorted(window)[len(window) // 2]:5d} "
                  f"mean={sum(window) // len(window):5d} lean={lean:3d} "
                  f"back-to-back lean={back_to_back:3d}")

    report(tail, "before")
    report(seq, "after")

    drops_data["drops"] = drops[:sort_from] + seq
    drops_path.write_text(json.dumps(drops_data, indent=2) + "\n")
    print(f"Wrote {drops_path}")


if __name__ == "__main__":
    main()
