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
  - A drop's difficulty is its Rare+ count from scripts/drop-difficulty.json:
    the playable words containing it that still score Rare or better after the
    fold caps inflections at their base. That is the measure the difficulty
    tiers were cut on (PR #202), applied here to the days that survived the
    parking rather than to the parking decision. The bottom fifth of the
    scheduled days are "hard" and two hard days repel each other over a week;
    the cut is read off the rotation, so it moves with the data.
  - Simulated annealing (fixed seed, deterministic) swaps drops within
    same-length slots -- the 2-letter/3-letter cadence never changes -- to
    minimize: overlap with the previous 3 days, plus a penalty for two
    tion-leaning drops landing within 30 days of each other, plus a penalty
    for two hard drops landing within a week, plus a tiny drift term that
    keeps drops near their original position when nothing forces a move. The
    already-played days before the cut are included as fixed context, so the
    first reordered days also steer clear of them.
  - Drops listed in seededDrops are pinned where they sit. They are published
    drops dealt a second time by scripts/reseed-drops.py, placed by hand so
    the ones with archive play land far out; the sort may arrange the rotation
    around them but never moves them.
  - From EASY_FROM on, the busiest days of the week (EASY_WEEKDAYS) get the
    easy drops: each one costs EASY_WEIGHT times how far its Rare+ count sits
    from the top of its own length class, so a 3-letter Tuesday gets one of
    the richest 3-letter drops rather than the cadence being bent to hand it a
    2-letter one. Those days are also kept varied against each other: each is
    compared with the busy days before it (VARIETY_WEIGHTS, by how many busy
    days back) on how alike the two drops' words are -- the larger of their
    familiar-word overlap and how alike the word endings and the word starts
    they over-represent are, so IES next to ESS is fine but TIO next to ATI,
    or ITY next to TY, is not.
  - Some days have already been reviewed for the drop they hold: the daily
    fold check has judged every puzzle through
    scripts/fold-audit/checked-through.txt, and each estimate batch in
    src/data/estimated-zipf.json covers the drops of the dates it names. A
    drop only swaps with another drop reviewed the same way, so no unreviewed
    drop moves into a reviewed day and no swept drop loses its estimates. A
    one-day estimate batch pins its drop. The reviewed fold fixes and the
    estimate batches' drop lists are then re-dated to the new order (see
    redate_fold_fixes and relabel_estimate_batches).
"""
import json
import math
import random
import re
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"

FAMILIAR_ZIPF_HUNDREDTHS = 300
OVERLAP_WEIGHTS = {1: 1.0, 2: 0.4, 3: 0.15}  # by day distance
TION_FLOOR = 0.10     # drops below 10% tion share don't repel each other
TION_WINDOW = 30      # days over which two tion drops repel
TION_WEIGHT = 6.0
HARD_QUANTILE = 0.2  # the fraction of scheduled days counted as hard
HARD_WINDOW = 7      # days over which two hard drops repel
HARD_WEIGHT = 3.0
DRIFT = 2e-5          # tie-breaker toward a drop's original position
# Tuesday and Thursday had the most daily visitors by mean (the analytics
# report's daily series, 2026-08-24..2026-10-22, 2026-09-01.. and
# 2026-09-27..: Tue 50/54/79, Thu 48/51/76, every other day lower).
EASY_FROM = date(2026, 11, 2)
EASY_WEEKDAYS = {1: "Tue", 3: "Thu"}  # date.weekday()
EASY_WEIGHT = 2.0
VARIETY_WEIGHTS = {1: 1.0, 2: 0.6, 3: 0.3, 4: 0.15}  # by busy days back
FOLD_TABLES = ("fold-exemptions.json", "fold-review-verdicts.json")
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

    difficulty_path = ROOT / "scripts" / "drop-difficulty.json"
    rare_plus = json.loads(difficulty_path.read_text())["rarePlus"]
    missing = sorted(set(drops) - set(rare_plus))
    if missing:
        sys.exit(f"{difficulty_path.name} has no rating for {', '.join(missing)}; "
                 "re-run scripts/drop-difficulty.py")

    dictionary = json.loads((DATA / "dictionary.json").read_text())
    zipf = json.loads((DATA / "rarity.json").read_text())["zipfHundredths"]
    rejections = set(json.loads((DATA / "word-rejections.json").read_text()))
    # The derived rejections count too -- an unplayable word must not make a drop
    # look richer than it is.
    for batch in json.loads((DATA / "derived-rejections.json").read_text()).values():
        for words in batch.values():
            rejections.update(words)

    # ngram -> bitmask over the familiar playable words, and for the drops in
    # the rotation, how often their words end and start with each trigram
    tion_mask = 0
    masks: dict[str, int] = {}
    rotation = {d.lower() for d in drops}
    ends: dict[str, Counter] = {g: Counter() for g in rotation}
    starts: dict[str, Counter] = {g: Counter() for g in rotation}
    all_ends: Counter = Counter()
    all_starts: Counter = Counter()
    wid = 0
    for i, word in enumerate(dictionary):
        if word in rejections or zipf[i] < FAMILIAR_ZIPF_HUNDREDTHS:
            continue
        bit = 1 << wid
        wid += 1
        if "tion" in word:
            tion_mask |= bit
        all_ends[word[-3:]] += 1
        all_starts[word[:3]] += 1
        grams = {word[j:j + n] for n in (2, 3) for j in range(len(word) - n + 1)}
        for g in grams:
            masks[g] = masks.get(g, 0) | bit
            if g in rotation:
                ends[g][word[-3:]] += 1
                starts[g][word[:3]] += 1

    mask_of = {d: masks.get(d.lower(), 0) for d in set(drops)}
    count_of = {d: m.bit_count() for d, m in mask_of.items()}
    tion_of = {d: ((m & tion_mask).bit_count() / c if (c := count_of[d]) else 0.0)
               for d, m in mask_of.items()}

    # A day is hard when little of what it reaches is worth banking. The cut is
    # the bottom HARD_QUANTILE of the scheduled days -- not of the candidate
    # pool, which still holds the drops parked in challengingDrops and
    # hardDrops, and would drag the cut down to days no one will ever play.
    scheduled = sorted(rare_plus[d] for d in drops)
    hard_cut = scheduled[int(len(scheduled) * HARD_QUANTILE)]
    hard_of = {d: max(0.0, (hard_cut - rare_plus[d]) / hard_cut) for d in mask_of}

    overlap_cache: dict[tuple[str, str], float] = {}

    def overlap(a: str, b: str) -> float:
        key = (a, b) if a <= b else (b, a)
        v = overlap_cache.get(key)
        if v is None:
            lo = min(count_of[a], count_of[b])
            v = (mask_of[a] & mask_of[b]).bit_count() / lo if lo else 0.0
            overlap_cache[key] = v
        return v

    # What a drop's words over-represent at their ends and starts: each trigram's
    # share of the drop's familiar words, less its share of all of them, so the
    # -ing and -ion every drop catches some of cancel out and what is left is
    # the drop's own family (-ness for NES, -tion for TIO and ATI).
    def excess(counts: Counter, base: Counter) -> dict[str, float]:
        total, base_total = sum(counts.values()), sum(base.values())
        out = {}
        for k, v in counts.items():
            e = v / total - base[k] / base_total
            if e > 0:
                out[k] = e
        return out

    end_excess = {d: excess(ends[d.lower()], all_ends) for d in mask_of}
    start_excess = {d: excess(starts[d.lower()], all_starts) for d in mask_of}

    def cosine(a: dict[str, float], b: dict[str, float]) -> float:
        num = sum(v * b[k] for k, v in a.items() if k in b)
        den = math.sqrt(sum(v * v for v in a.values()) * sum(v * v for v in b.values()))
        return num / den if den else 0.0

    likeness_cache: dict[tuple[str, str], float] = {}

    def likeness(a: str, b: str) -> float:
        """How alike the words two drops reach are, 0..1."""
        key = (a, b) if a <= b else (b, a)
        v = likeness_cache.get(key)
        if v is None:
            v = max(overlap(a, b),
                    cosine(end_excess[a], end_excess[b]),
                    cosine(start_excess[a], start_excess[b]))
            likeness_cache[key] = v
        return v

    tail = drops[sort_from:]
    n = len(tail)
    assert len(set(tail)) == n, "duplicate drop in the sortable tail"
    context = drops[sort_from - TION_WINDOW:sort_from]  # fixed, already played
    orig_index = {d: i for i, d in enumerate(tail)}

    def day(i: int) -> date:
        return epoch + timedelta(days=sort_from + i)

    # How easy a drop is against the others of its length still to be dealt:
    # 1 for the richest, 0 for the poorest.
    easy_of: dict[str, float] = {}
    for length in (2, 3):
        ranked = sorted((d for d in tail if len(d) == length), key=lambda d: rare_plus[d])
        for r, d in enumerate(ranked):
            easy_of[d] = r / (len(ranked) - 1) if len(ranked) > 1 else 1.0

    def busy(d: date) -> bool:
        return d >= EASY_FROM and d.weekday() in EASY_WEEKDAYS

    # For each busy day, how many days back each of the busy days before it
    # sits (nearest first), so the variety term need not walk the calendar.
    is_busy = [busy(day(i)) for i in range(n)]
    busy_back: list[list[int]] = []
    for i in range(n):
        back: list[int] = []
        if is_busy[i]:
            k = 1
            while len(back) < len(VARIETY_WEIGHTS) and k <= TION_WINDOW:
                if busy(day(i - k)):
                    back.append(k)
                k += 1
        busy_back.append(back)

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
        h = hard_of[d]
        if h > 0:
            for k in range(1, HARD_WINDOW + 1):
                p = prev_drop(seq, i - k)
                if p is not None and hard_of[p] > 0:
                    c += HARD_WEIGHT * h * hard_of[p] * (HARD_WINDOW - k + 1) / HARD_WINDOW
        if is_busy[i]:
            c += EASY_WEIGHT * (1.0 - easy_of[d])
            for back, k in enumerate(busy_back[i], start=1):
                p = prev_drop(seq, i - k)
                if p is not None:
                    c += VARIETY_WEIGHTS[back] * likeness(p, d)
        return c + DRIFT * abs(orig_index[d] - i)

    def cost_around(seq: list[str], positions: tuple[int, int]) -> float:
        affected = set()
        for p in positions:
            affected.update(q for q in range(p, p + TION_WINDOW + 1) if q < n)
        return sum(local_cost(seq, i) for i in affected)

    # Re-seeded drops keep the day they were given; everything else moves
    # around them.
    pinned = set(drops_data["seededDrops"])
    print(f"pinned: {sum(1 for d in tail if d in pinned)} re-seeded days held in place")

    # A drop swaps only within its length and its stretch of reviewed days.
    estimates_path = DATA / "estimated-zipf.json"
    estimates = json.loads(estimates_path.read_text())
    checked_path = ROOT / "scripts" / "fold-audit" / "checked-through.txt"
    checked_through = date.fromisoformat(checked_path.read_text().strip())
    edges = {checked_through + timedelta(days=1)}
    for batch in estimates["batches"]:
        since = date.fromisoformat(batch["since"])
        edges |= {since, since + timedelta(days=len(batch_drops(batch)))}
    edges = sorted(edges)
    groups: dict[tuple[int, int], list[int]] = {}
    for i, d in enumerate(tail):
        if d not in pinned:
            stretch = sum(1 for e in edges if e <= day(i))
            groups.setdefault((len(d), stretch), []).append(i)
    swappable = [g for g in groups.values() if len(g) > 1]
    held = sum(1 for g in groups.values() if len(g) == 1)
    print(f"held: {held} days alone in their reviewed stretch")
    group_of = {i: g for g in swappable for i in g}
    slots = sorted(group_of)

    def anneal(seed: int) -> list[str]:
        rng = random.Random(seed)
        seq = list(tail)
        for step in range(STEPS):
            temp = T_START * (T_END / T_START) ** (step / STEPS)
            i = rng.choice(slots)
            j = rng.choice(group_of[i])
            if i == j:
                continue
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
        hard_days = [i for i in range(sort_from, len(full)) if hard_of[full[i]] > 0]
        hard_gaps = [b - a for a, b in zip(hard_days, hard_days[1:])]
        weeks = [sum(1 for i in hard_days if w <= i < w + 7)
                 for w in range(sort_from, len(full) - 7)]
        print(f"--- {label} ---")
        print(f"  adjacent overlap: mean={sum(ovs) / len(ovs):.4f} max={max(ovs):.3f} "
              f">=30%: {sum(o >= 0.3 for o in ovs)}")
        if gaps:
            print(f"  tion-heavy days (>=25% share): {len(tion_days)}; day gaps "
                  f"min={min(gaps)} median={sorted(gaps)[len(gaps) // 2]}; "
                  f"first: {epoch + timedelta(days=tion_days[0])} ({full[tion_days[0]]})")
        print(f"  hard days (Rare+ answers <= {hard_cut}): {len(hard_days)}; "
              f"back to back: {sum(g == 1 for g in hard_gaps)}; "
              f"within 3 days: {sum(g <= 3 for g in hard_gaps)}; "
              f"worst week: {max(weeks)} of 7")
        busy_days = [i for i in range(n) if is_busy[i]]
        if busy_days:
            easy = [easy_of[t[i]] for i in busy_days]
            alike = [likeness(t[i - busy_back[i][0]], t[i])
                     for i in busy_days if busy_back[i] and i - busy_back[i][0] >= 0]
            names = "/".join(EASY_WEEKDAYS.values())
            print(f"  {names} days: {len(busy_days)}; mean easiness {sum(easy) / len(easy):.2f} "
                  f"(0 poorest .. 1 richest of its length); in the richest third: "
                  f"{sum(e >= 2 / 3 for e in easy)}; hard: "
                  f"{sum(hard_of[t[i]] > 0 for i in busy_days)}")
            if alike:
                print(f"  likeness to the busy day before: mean={sum(alike) / len(alike):.3f} "
                      f"max={max(alike):.3f} >=50%: {sum(a >= 0.5 for a in alike)}")

    report(tail, "before")
    report(seq, "after")

    new_full = drops[:sort_from] + seq
    drops_data["drops"] = new_full
    drops_path.write_text(json.dumps(drops_data, indent=2) + "\n")
    print(f"Wrote {drops_path}")

    redate_fold_fixes(new_full, epoch, day(0), checked_through)
    relabel_estimate_batches(estimates, new_full, epoch, day(0))
    estimates_path.write_text(json.dumps(estimates, indent=2) + "\n")
    print(f"Wrote {estimates_path}")


def batch_drops(batch: dict) -> list[str]:
    """An estimate batch's drops, one per day from its `since`."""
    return [d.strip() for d in batch["drop"].split(",") if d.strip()]


FLAGGED_ON = re.compile(r"for the (\d{4}-\d{2}-\d{2}) `([A-Z]+)` drop")


def redate_fold_fixes(rotation: list[str], epoch: date, first: date, checked: date) -> None:
    """Date every reviewed fold fix from the first puzzle that now reaches it.

    The daily fold check dates each fix from the earliest puzzle whose drop the
    word contains (apply-daily.py), so a reviewed drop moved to an earlier day
    would leave its fixes starting after it. Each fix the check made on a
    re-sorted day starts instead at the earliest re-sorted, checked day whose
    drop the word contains, as the check itself would have dated it, and its
    reason names the day its drop now falls on. A fix added by hand on review
    (no "flagged ... drop" in its reason) only ever moves earlier, and a word
    another fix redirects to never starts after the fix that redirects to it.
    Every day touched is a re-sorted one, so no one has played it.
    """
    if first > checked:
        return
    window = [first + timedelta(days=k) for k in range((checked - first).days + 1)]
    drop_on = {t: rotation[(t - epoch).days] for t in window}
    day_of = {d: t for t, d in drop_on.items()}
    lo, hi = first.isoformat(), checked.isoformat()
    paths = [DATA / name for name in FOLD_TABLES]
    tables = [json.loads(p.read_text()) for p in paths]
    moved = 0
    for table in tables:
        for word, entry in table.items():
            if not lo <= entry["since"] <= hi:
                continue
            since = entry["since"]
            reaches = [t.isoformat() for t in window if drop_on[t].lower() in word]

            def relabel(m: re.Match) -> str:
                t = day_of.get(m.group(2))
                return f"for the {t.isoformat()} `{m.group(2)}` drop" if t else m.group(0)

            flagged = FLAGGED_ON.search(entry["reason"]) is not None
            entry["reason"] = FLAGGED_ON.sub(relabel, entry["reason"])
            if reaches:
                # A fix the check made starts where the check would now make
                # it; one added by hand on review only ever starts sooner.
                since = reaches[0] if flagged else min(since, reaches[0])
            if since != entry["since"]:
                entry["since"] = since
                moved += 1
    changed = True
    while changed:
        changed = False
        for table in tables:
            for entry in table.values():
                base = entry.get("base")
                for other in tables:
                    target = other.get(base) if base and entry["since"] >= lo else None
                    if target and lo <= target["since"] <= hi and target["since"] > entry["since"]:
                        target["since"] = entry["since"]
                        moved += 1
                        changed = True
    for path, table in zip(paths, tables):
        path.write_text(json.dumps(table, indent=2) + "\n")
    print(f"Re-dated {moved} fold fixes checked through {hi}")


def relabel_estimate_batches(estimates: dict, rotation: list[str], epoch: date,
                             first: date) -> None:
    """Name each batch's re-sorted days by the drop they now hold.

    A batch's drops are read one per day from its `since`
    (src/game/zipf-coverage.test.ts), so the names follow the new order. The
    estimates themselves stay as they are: every drop stayed inside the
    batches that swept it.
    """
    for batch in estimates["batches"]:
        since = date.fromisoformat(batch["since"])
        names = batch_drops(batch)
        for k in range(len(names)):
            t = since + timedelta(days=k)
            if t >= first:
                names[k] = rotation[(t - epoch).days]
        batch["drop"] = ", ".join(names)


if __name__ == "__main__":
    main()
