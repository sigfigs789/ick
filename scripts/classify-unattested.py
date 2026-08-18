#!/usr/bin/env python3
"""Assign rarity tiers to the dictionary words nothing can score.

The frequency waterfall (see frequency.py) leaves ~8.8k curated words with no
Zipf at all. Most are reachable anyway: the base-form rules in
src/game/dictionary.ts fold them onto a measured base ("circularnesses" onto
"circularness"), and those are none of this script's business -- they already
score off real data. This script skips every one of them (see runtime_resolved)
and grades only the ~2k left with nothing to score from.

Those would otherwise tie at a perfect 10.00, which is right for a genuine
obscure headword ("kharzy") and wrong for a form the suffix machinery merely
permits ("agonisingliest"). No measurement separates the two, so this script
applies a spelling heuristic and writes its verdict to src/data/ai-tiers.json.
That file is AI-assigned judgement, NOT measured data: every word in it is listed
by name so the calls stay auditable and revisable. Nothing else in the pipeline
invents scores this way.

Grading only ever lowers a score -- finding a base can cost a word score, never
earn it any. src/game/dictionary.test.ts asserts that across the whole
dictionary.

Tiers:
  inherit   -- a spelling variant or inflection of another dictionary word;
               scores off that word's frequency, exactly like every other
               derived form. Carries the base so the substitution is visible.
  lemma     -- a standalone headword with nothing strippable. Keeps the perfect
               10.00: absence from all three corpora is real rarity evidence.
  derived   -- a transparent derivation (-ist/-ic/-ical/-ly/-ness) off an
               attested base. Capped at 9.80.
  artifact  -- a form that exists because a suffix rule permits it, not because
               anyone uses it: comparatives of non-gradable bases, stacked
               -ness, multi-step chains. Capped at 9.50, below the Legend line.

Run:
    python3 scripts/classify-unattested.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "src" / "data"

# Assigned-on date and generator identity, recorded in the output so a future
# reader (human or agent) can tell at a glance that these are judgement calls.
ASSIGNED_BY = "claude-opus-5"
ASSIGNED_ON = "2026-08-17"
HEURISTIC_VERSION = "ai-heuristic-v1"

# A base this common means the suffix is doing the rarity work, not the word:
# "quagmire" (Zipf 2.75) plus "-r" is not a discovery. Below it, the base is
# itself deep-tail and the derived form inherits genuine obscurity.
COMMON_BASE_ZIPF = 1.5

# Commonwealth spellings, checked against their American twin. Suffix-anchored
# so "wise" is not rewritten to "wize".
VARIANT_SUFFIXES = [
    ("isations", "izations"), ("isation", "ization"),
    ("isings", "izings"), ("ising", "izing"),
    ("isers", "izers"), ("iser", "izer"),
    ("ises", "izes"), ("ised", "ized"), ("ise", "ize"),
    ("ysing", "yzing"), ("yses", "yzes"), ("ysed", "yzed"), ("yse", "yze"),
    ("ours", "ors"), ("our", "or"),
]

# Transparent derivations: real word-formation, but one step off a base whose
# frequency we do know. -ism and -ment are deliberately absent for the reason
# boundBaseCandidates() in src/game/stem.ts gives: they are opaque, and a
# spelling-only rule collapses them onto unrelated words ("aeonism" -> "aeon",
# "battlement" -> "battle"). Those stay lemmas.
DERIVATION_SUFFIXES = ["ically", "ical", "ists", "ist", "ic", "ly"]

# Gradable/abstract suffixes. These produce an artifact only on a base common
# enough that the suffix is doing all the rarity work -- on a deep-tail base
# ("quagmiry", Zipf -0.23) the comparative inherits genuine obscurity instead.
ARTIFACT_SUFFIXES = ["liest", "lier", "iest", "ier", "est", "er", "nesses", "ness"]

# Transparent prefixes: "misenroll" is enroll with a prefix, not a headword.
PREFIXES = ["mis", "non", "over", "under", "counter", "super", "semi", "anti",
            "pseudo", "hyper", "inter", "multi", "micro", "un", "re", "pre",
            "post", "sub", "out", "co", "de", "dis"]

# The bound derivational suffixes src/game/stem.ts already folds onto their base
# at runtime. Mirrored here so the tier file agrees with what scoring actually
# does rather than calling these words headwords.
BOUND_SUFFIXES = [("izations", "ize"), ("isations", "ise"), ("ization", "ize"),
                  ("isation", "ise"), ("abilities", "able"), ("ibilities", "ible"),
                  ("ability", "able"), ("ibility", "ible")]

# Latin/Greek plurals the -s/-es rules cannot reach.
CLASSICAL_PLURALS = [("a", "um"), ("a", "on"), ("i", "us"), ("ae", "a"),
                     ("es", "is"), ("ices", "ex"), ("ices", "ix"), ("ima", "imum")]


def load():
    words = json.loads((OUT_DIR / "dictionary.json").read_text())
    rarity = json.loads((OUT_DIR / "rarity.json").read_text())
    hundredths = rarity["zipfHundredths"]
    index = {w: i for i, w in enumerate(words)}
    return words, hundredths, index


def strip_doubled(stem: str) -> str:
    if len(stem) > 3 and stem[-1] == stem[-2] and stem[-1] in "bcdfghjklmnpqrstvwxyz":
        return stem[:-1]
    return stem


def variant_twin(word: str):
    """The American twin of a Commonwealth spelling, if we have one."""
    for british, american in VARIANT_SUFFIXES:
        if word.endswith(british):
            yield word[: -len(british)] + american


def bound_bases(word: str):
    """Bases for the bound derivational suffixes ("aggrandization" ->
    "aggrandize"), matching boundBaseCandidates() in src/game/stem.ts."""
    for suffix, replacement in BOUND_SUFFIXES:
        if len(word) > len(suffix) + 1 and word.endswith(suffix):
            base = word[: -len(suffix)] + replacement
            if len(base) >= 5 and base != word:
                yield base


def inflection_bases(word: str):
    """Plural / third-person / tense bases, including the -e singular that a
    plain "strip -es" rule misses ("cabotages" -> "cabotage", not "cabotag")."""
    if len(word) > 5 and word.endswith("ies"):
        yield word[:-3] + "y"
    # "counterrallied" -> "counterrally". Without this the word looks like a
    # prefixed derivation of "rallied" rather than the past tense of an
    # attested deep-tail verb, and lands in the wrong tier.
    if len(word) > 5 and word.endswith("ied"):
        yield word[:-3] + "y"
    if len(word) > 6 and word.endswith("ying"):
        yield word[:-4] + "y"
    if len(word) > 4 and word.endswith("es"):
        yield word[:-1]   # singular keeps its "e": cabotage, acutance
        yield word[:-2]   # singular does not: abattis
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        yield word[:-1]
    for plural, singular in CLASSICAL_PLURALS:
        if len(word) > len(plural) + 3 and word.endswith(plural):
            yield word[: -len(plural)] + singular
    if len(word) > 5 and word.endswith("ing"):
        stem = word[:-3]
        yield stem + "e"
        yield stem
        yield strip_doubled(stem)
    if len(word) > 4 and word.endswith("ed"):
        stem = word[:-2]
        yield stem + "e"
        yield stem
        yield strip_doubled(stem)


def suffix_bases(word: str, suffix: str):
    """Candidate bases after removing `suffix`. Covers the -y/-i comparative swap
    ("shonkier" -> "shonky"), the silent -e a suffix absorbs ("amortisablest" ->
    "amortisable", "decuply" -> "decuple"), and the consonant a comparative
    doubles ("braggier" -> "brag")."""
    stem = word[: -len(suffix)]
    if len(stem) < 3:
        return
    # A comparative's base is the adjective, not a noun that happens to share the
    # spelling: "quagmirier" is "quagmiry" (Zipf -0.23) inflected, NOT "quagmire"
    # (2.75) -- and the two produce opposite tiers. Try the adjective first.
    if suffix in ("ier", "iest", "lier", "liest"):
        yield stem + "y"    # shonkier -> shonky, quagmirier -> quagmiry
        yield stem + "i"    # chichier -> chichi
        yield stem + "ey"
    yield stem
    yield stem + "e"
    yield stem + "le"          # decuply -> decuple
    yield strip_doubled(stem)
    if stem.endswith("i"):
        yield stem[:-1] + "y"  # shonkier -> shonky
        yield stem[:-1]        # havocker -> havoc (via the trailing-cut below)
        yield strip_doubled(stem[:-1])
    if len(stem) > 3:
        yield stem[:-1]        # havocker -> havoc
        yield strip_doubled(stem[:-1])


def runtime_resolved(word, index, hundredths, sentinel):
    """Whether the existing scoring rules already find this word a base.

    Mirrors adjustedZipf() in src/game/dictionary.ts: the tense-base rule, then
    baseForm()'s inflections, the -ness/-ly suffixes, and the bound derivational
    suffixes. Those all work from measured frequency, so anything they resolve is
    already handled and must not be graded here -- the tier file exists only for
    the words they leave with nothing to score from.
    """

    def zipf(candidate):
        i = index.get(candidate)
        return None if i is None else hundredths[i] / 100

    sentinel_zipf = sentinel / 100

    # tenseBaseForm: -ed / -ing / -ied / -ying, preferring the most common base.
    candidates = []
    if len(word) > 5 and word.endswith("ied"):
        candidates.append(word[:-3] + "y")
    elif len(word) > 4 and word.endswith("ed"):
        stem = word[:-2]
        candidates += [stem + "e", stem, strip_doubled(stem)]
    if len(word) > 4 and word.endswith("ying"):
        candidates += [word[:-4] + "y", word[:-4] + "ie"]
    elif len(word) > 5 and word.endswith("ing"):
        stem = word[:-3]
        candidates += [stem + "e", stem, strip_doubled(stem)]
    tense = max((c for c in candidates if c in index), key=lambda c: zipf(c), default=None)
    if tense is not None:
        return zipf(tense) != sentinel_zipf

    # scoringBaseForm: baseForm()'s inflections, then -ness / -ly, then bound.
    inflected = base_form_js(word)
    if inflected != word and inflected in index:
        return zipf(inflected) > sentinel_zipf
    for suffix in ("ness", "ly"):
        if not word.endswith(suffix) or len(word) <= len(suffix) + 2:
            continue
        stem = word[: -len(suffix)]
        for candidate in (stem, stem[:-1] + "y" if stem.endswith("i") else ""):
            if candidate and candidate in index:
                return zipf(candidate) > sentinel_zipf
    for candidate in bound_bases(word):
        if candidate in index:
            return zipf(candidate) > sentinel_zipf
    return False


def base_form_js(word: str) -> str:
    """baseForm() from src/game/stem.ts, exactly -- including the "es" test that
    precedes the "s" test, which is what makes it miss "cabotages"."""
    if len(word) > 5 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 6 and word.endswith("ying"):
        return word[:-4] + "y"
    if len(word) > 5 and word.endswith("ing"):
        return strip_doubled(word[:-3])
    if len(word) > 5 and word.endswith("ied"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("ed"):
        return strip_doubled(word[:-2])
    if len(word) > 4 and word.endswith("es"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def classify(words, hundredths, index, sentinel):
    """Walk every sentinel word once, in tier order. The first rule that finds a
    dictionary-backed base wins."""

    def attested(candidate: str):
        i = index.get(candidate)
        if i is None or hundredths[i] == sentinel:
            return None
        return hundredths[i] / 100

    def resolve(candidate: str, seen: set):
        """Follow a variant/inflection chain to the first attested word.
        "novelisers" -> "novelizers" -> "novelizer". Returns (base, zipf)."""
        if candidate in seen or candidate not in index:
            return None
        seen.add(candidate)
        zipf = attested(candidate)
        if zipf is not None:
            return candidate, zipf
        for nxt in (list(variant_twin(candidate)) + list(inflection_bases(candidate))
                    + list(bound_bases(candidate))):
            hit = resolve(nxt, seen)
            if hit:
                return hit
        return None

    def unattested_base(word: str):
        """The nearest dictionary word this one inflects, when that base is
        itself unattested. "deplatformed" -> "deplatform": the base gets its own
        grade, and the inflection should follow it rather than be read as a
        prefixed derivation of "platformed"."""
        for candidate in (list(variant_twin(word)) + list(inflection_bases(word))
                          + list(bound_bases(word))):
            if candidate != word and candidate in index:
                return candidate
        return None

    tiers = {"inherit": {}, "lemma": [], "derived": {}, "artifact": {}}
    unattested = [w for i, w in enumerate(words) if hundredths[i] == sentinel]
    # Only the words the existing rules cannot place. Everything else already
    # scores off measured frequency and is none of this file's business.
    sentinel_words = [
        w for w in unattested if not runtime_resolved(w, index, hundredths, sentinel)
    ]
    print(
        f"{len(unattested)} words carry no corpus frequency; "
        f"{len(unattested) - len(sentinel_words)} are already resolved by the "
        f"existing rules, leaving {len(sentinel_words)} to grade"
    )

    for word in sentinel_words:
        # 1. Spelling variant, then 2. inflection -- both inherit outright.
        hit = None
        for candidate in (list(variant_twin(word)) + list(inflection_bases(word))
                          + list(bound_bases(word))):
            hit = resolve(candidate, {word})
            if hit:
                break
        if hit:
            tiers["inherit"][word] = hit[0]
            continue

        # 2b. The base is in the dictionary but unattested too -- inherit it
        #     anyway and let the chain resolve to whatever grade it receives.
        chained = unattested_base(word)
        if chained:
            tiers["inherit"][word] = chained
            continue

        # 3. Gradable/abstract suffix. Whether this is an artifact turns on the
        #    base: a common base means the suffix invented the rarity (cap it),
        #    a deep-tail base means the form inherits real obscurity (inherit).
        graded = None
        for suffix in ARTIFACT_SUFFIXES:
            if not word.endswith(suffix) or len(word) <= len(suffix) + 2:
                continue
            for base in suffix_bases(word, suffix):
                zipf = attested(base)
                if zipf is not None:
                    graded = (base, zipf, suffix)
                    break
            if graded:
                break
        if graded:
            base, zipf, suffix = graded
            # Stacked -nesses is an artifact at any base frequency -- nobody
            # pluralises an abstract noun twice over. Otherwise the base's own
            # frequency decides.
            if suffix == "nesses" or zipf >= COMMON_BASE_ZIPF:
                tiers["artifact"][word] = base
            else:
                tiers["inherit"][word] = base
            continue

        # 4. Transparent derivation off an attested base.
        derived = None
        for suffix in DERIVATION_SUFFIXES:
            if not word.endswith(suffix) or len(word) <= len(suffix) + 2:
                continue
            for base in suffix_bases(word, suffix):
                if attested(base) is not None:
                    derived = base
                    break
            if derived:
                break

        # 5. Transparent prefix on an attested word ("misenroll" -> "enroll").
        if not derived:
            for prefix in PREFIXES:
                if not word.startswith(prefix) or len(word) <= len(prefix) + 3:
                    continue
                if attested(word[len(prefix):]) is not None:
                    derived = word[len(prefix):]
                    break
        if derived:
            tiers["derived"][word] = derived
            continue

        # 6. Nothing strippable -- a standalone headword.
        tiers["lemma"].append(word)

    return tiers, sentinel_words


def main() -> None:
    words, hundredths, index = load()
    sentinel = min(hundredths)
    tiers, sentinel_words = classify(words, hundredths, index, sentinel)

    payload = {
        "_readme": (
            "AI-ASSIGNED, NOT MEASURED. Every word below is a curated dictionary "
            "entry that no frequency corpus attests AND that the base-form rules "
            "in src/game/dictionary.ts cannot fold onto a measured base -- so "
            "there is nothing at all to score it from. Words those rules do "
            "resolve are deliberately absent: they score off real data and need "
            "no judgement. These tiers are a judgement call about whether the "
            "word is a genuine rare headword or a form the suffix machinery "
            "merely permits. Grading only ever lowers a score, never raises one. "
            "Applies to puzzles from 2026-08-19. Regenerate with "
            "scripts/classify-unattested.py; override individual calls by editing "
            "this file (the generator preserves nothing, so record manual edits "
            "in the repo history)."
        ),
        "assignedBy": ASSIGNED_BY,
        "assignedOn": ASSIGNED_ON,
        "heuristic": HEURISTIC_VERSION,
        "generator": "scripts/classify-unattested.py",
        "tiers": {
            "inherit": {
                "_meaning": "Spelling variant or inflection: scores off the listed base word's frequency.",
                "words": dict(sorted(tiers["inherit"].items())),
            },
            "lemma": {
                "_meaning": "Standalone headword, nothing strippable. Keeps the perfect 10.00.",
                "words": sorted(tiers["lemma"]),
            },
            "derived": {
                "_meaning": "Transparent derivation off the listed attested base. Score capped at 9.80.",
                "maxScore": 9.8,
                "words": dict(sorted(tiers["derived"].items())),
            },
            "artifact": {
                "_meaning": "Suffix-machinery form off the listed base. Score capped at 9.50, below Legend.",
                "maxScore": 9.5,
                "words": dict(sorted(tiers["artifact"].items())),
            },
        },
    }
    (OUT_DIR / "ai-tiers.json").write_text(json.dumps(payload, indent=1, sort_keys=False))

    total = len(sentinel_words)
    print(f"{total} words graded (the rest are handled by the existing rules)")
    for name in ("inherit", "lemma", "derived", "artifact"):
        n = len(tiers[name])
        print(f"  {name:9s} {n:5d}  ({n / total:5.1%})")
    print(f"Wrote {OUT_DIR / 'ai-tiers.json'}")


if __name__ == "__main__":
    main()
