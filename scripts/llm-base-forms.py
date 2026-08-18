#!/usr/bin/env python3
"""LLM-adjudicated base forms: stop derived words from out-scoring their roots.

Frequency data alone makes a word like "lactational" (Zipf 1.13, a 9.71 Mythic)
look far rarer than "lactation" (Zipf 2.84, a 7.19 Rare), even though anyone who
knows the base can produce the derived form. src/game/dictionary.ts already caps
a handful of *unambiguous* affixes this way (-ly, -ness, -ization, -ability, and
the -ed/-ing tense forms), but those rules are deliberately spelling-only, so the
long tail of productive affixes -- -al, -ic, -ist, -ish, -er, non-, over-, pre-,
out-, mis- ... -- is left alone because a purely mechanical rule cannot tell
"lactational" -> "lactation" (genuine) from "outrage" -> "rage" (coincidence).

That judgement is what an LLM is for, and this script is the pipeline around it:

  1. --candidates : a deterministic prefilter over dictionary.json. Emits
     (word, proposed base) pairs where the word still scores in the elite band
     *after* the game's existing adjustment, some affix rule reaches a real
     dictionary word, and that base is meaningfully more common. Cheap, exact,
     and it does the narrowing so the LLM only sees plausible pairs.
  2. --adjudicate : asks Claude, one batch at a time, whether each pair is a
     genuine transparent derivation. Verdicts are appended to
     scripts/llm-base-forms.txt as reviewable `word<TAB>base<TAB>yes|no` rows,
     so the judgement lands in the PR diff rather than in an opaque blob.
     Needs ANTHROPIC_API_KEY. Verdicts already in the file are never re-asked.
  3. --compile (the default) : turns the `yes` rows into
     src/data/llm-base-forms.json, index-aligned with dictionary.json.

The bias throughout is toward leaving scores alone: an unadjudicated word, a
`no`, or any verdict the model marked low-confidence keeps its own frequency. The
adjustment can only ever make a word *less* rare, never rarer, so a bad `yes`
costs one inflated score its inflation -- it can never invent a Legend.

Run:
    python3 scripts/llm-base-forms.py --candidates > /tmp/candidates.tsv
    ANTHROPIC_API_KEY=... python3 scripts/llm-base-forms.py --adjudicate
    python3 scripts/llm-base-forms.py --compile
"""
import argparse
import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
DICTIONARY_PATH = ROOT / "src" / "data" / "dictionary.json"
RARITY_PATH = ROOT / "src" / "data" / "rarity.json"
VERDICTS_PATH = SCRIPTS / "llm-base-forms.txt"
OUT_PATH = ROOT / "src" / "data" / "llm-base-forms.json"

# Defaults chosen so the LLM only ever sees pairs where a wrong score is
# actually visible to a player. The elite band (Mythic 9.5+, Legend 9.9+) is
# where an unearned score does the most damage to the game, and a base that is
# itself rare has nothing to correct with. A whole Zipf point of gap is a 10x
# frequency difference -- the motivating case, "lactational" (1.13) against
# "lactation" (2.84), sits at 1.71 -- so anything tighter than that is not worth
# an API call. The base floor is 2.0 for the same reason: "lactation" is itself
# only a Rare word, and capping there still drops "lactational" from 9.71 to
# 7.19. Below 2.0 both words are deep-tail and there is nothing to correct with.
DEFAULT_MIN_SCORE = 9.5
DEFAULT_MIN_GAP = 1.0
DEFAULT_MIN_BASE_ZIPF = 2.0

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-opus-5"
DEFAULT_BATCH = 40

# Productive derivational suffixes. Every one of these is a *guess* at a base --
# the LLM decides. Longest-first so "-ically" is tried before "-ic".
SUFFIXES = [
    "ologist", "ically", "istic", "ation", "itive", "ative", "ition", "esque",
    "iness", "ology", "ically", "ility", "ance", "ence", "ancy", "ency",
    "ally", "ical", "ward", "wise", "hood", "ship", "less", "ette", "ward",
    "ment", "sion", "tion", "able", "ible", "ious", "ous", "ful", "ish", "ist",
    "ism", "ive", "ity", "ate", "ify", "ise", "ize", "ian", "ary", "ory",
    "age", "dom", "let", "ure", "ily", "ic", "al", "an", "ee", "en", "er",
    "or", "ry", "th", "y",
]

# Productive prefixes. The stem must itself be a dictionary word, which already
# rules out most accidents; the LLM catches the rest ("deliver" is not "de-" +
# "liver").
PREFIXES = [
    "counter", "pseudo", "quasi", "trans", "hyper", "inter", "intra", "micro",
    "multi", "super", "ultra", "after", "cross", "extra", "under", "anti",
    "auto", "back", "down", "fore", "mega", "mini", "mono", "over", "poly",
    "post", "self", "semi", "dis", "mid", "mis", "non", "out", "pre", "sub",
    "bi", "co", "de", "en", "em", "ex", "in", "im", "ir", "il", "re", "un",
    "up", "be",
]

# Shortest base we will ever propose. Below this the affix rules mostly find
# coincidences ("outed" -> "out"), and the LLM's time is better spent elsewhere.
MIN_BASE_LEN = 4


def load_scoring_helpers():
    """Import the hyphen-named manage-extra-word.py module for its pure scorers.

    Reused (the same way check-word.py does) so this script's idea of a word's
    current score is exactly the game's, including the base-form adjustment that
    is already in place -- otherwise the prefilter would keep proposing bases for
    words dictionary.ts has already fixed.
    """
    spec = importlib.util.spec_from_file_location(
        "manage_extra_word", SCRIPTS / "manage-extra-word.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["manage_extra_word"] = module
    spec.loader.exec_module(module)
    return module


class Lexicon:
    """dictionary.json + rarity.json with the game's scoring bolted on."""

    def __init__(self) -> None:
        self.words: list[str] = json.loads(DICTIONARY_PATH.read_text())
        hundredths: list[int] = json.loads(RARITY_PATH.read_text())["zipfHundredths"]
        self.index = {w: i for i, w in enumerate(self.words)}
        self._hundredths = hundredths
        self._max_zipf = max(hundredths) / 100
        self._sentinel = min(hundredths) / 100
        self._helpers = load_scoring_helpers()

    def zipf(self, word: str) -> float:
        return self._hundredths[self.index[word]] / 100

    def adjusted_zipf(self, word: str) -> float:
        """The word's Zipf after the *spelling-rule* adjustment only.

        Deliberately without the LLM map: this is the "before" the pipeline
        measures against, so a word already in llm-base-forms.json still reports
        the score it would have without it. Passing the map here would make the
        compile step's no-op check reject every pair it had already accepted.
        """
        return self._helpers.adjusted_zipf(word, self.index, self.zipf, {})

    def score(self, zipf: float) -> float:
        return self._helpers.current_score(zipf, self._max_zipf, self._sentinel)


def strip_doubled_consonant(stem: str) -> str:
    if len(stem) > 3 and stem[-1] == stem[-2] and stem[-1] in "bcdfghjklmnpqrstvwxyz":
        return stem[:-1]
    return stem


def base_candidates(word: str, lex: Lexicon) -> list[str]:
    """Every dictionary word an affix rule can reach from `word`.

    Spelling-only and deliberately over-generous -- restoring a dropped "e"
    ("volumise" -> "volume"), an "i"/"y" swap ("merciless" -> "mercy"), and an
    undoubled consonant. Precision is the LLM's job, not this function's.
    """
    out: list[str] = []

    def add(candidate: str) -> None:
        if (
            candidate
            and candidate != word
            and len(candidate) >= MIN_BASE_LEN
            and candidate in lex.index
            and candidate not in out
        ):
            out.append(candidate)

    for suffix in SUFFIXES:
        if not word.endswith(suffix):
            continue
        stem = word[: -len(suffix)]
        if len(stem) < MIN_BASE_LEN:
            continue
        add(stem)
        add(stem + "e")
        add(stem + "y")
        add(strip_doubled_consonant(stem))
        if stem.endswith("i"):
            add(stem[:-1] + "y")
            add(stem[:-1])

    for prefix in PREFIXES:
        if not word.startswith(prefix):
            continue
        add(word[len(prefix) :])

    return out


def find_candidates(lex: Lexicon, min_score: float, min_gap: float, min_base_zipf: float):
    """(word, base, word_score, base_score, gap) for every pair worth asking about.

    Only one base is proposed per word -- the most common one. If several affix
    readings are possible, the most common base is both the likeliest real root
    and the biggest correction, and a single proposal keeps the LLM's job binary.
    """
    rows = []
    for word in lex.words:
        own = lex.adjusted_zipf(word)
        word_score = lex.score(own)
        if word_score < min_score:
            continue
        bases = base_candidates(word, lex)
        if not bases:
            continue
        base = max(bases, key=lex.zipf)
        base_zipf = lex.zipf(base)
        if base_zipf < min_base_zipf or base_zipf - own < min_gap:
            continue
        rows.append((word, base, word_score, lex.score(base_zipf), base_zipf - own))
    rows.sort(key=lambda r: -r[4])
    return rows


# A `yes` this uncertain is treated as a `no` at compile time -- the whole point
# of the confidence column is that an unsure model must not move a score.
LOW_CONFIDENCE = "low"
CONFIDENCES = ("high", "medium", LOW_CONFIDENCE)


class Verdict(NamedTuple):
    base: str
    confirmed: bool
    # Why it was ruled that way. For a `yes` this is the affix class that made it
    # transparent (prefix-out, comparative, agent-noun ...); for a `no` it is the
    # ground for rejection (coincidence, wrong-base, drifted, technical, unsure).
    reason: str
    confidence: str

    @property
    def adjusts(self) -> bool:
        """Whether this verdict is allowed to move a score."""
        return self.confirmed and self.confidence != LOW_CONFIDENCE


def read_verdicts() -> dict[str, Verdict]:
    """word -> Verdict from the checked-in rows."""
    verdicts: dict[str, Verdict] = {}
    if not VERDICTS_PATH.exists():
        return verdicts
    for line in VERDICTS_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 5:
            sys.exit(f"malformed verdict row (want 5 tab-separated fields): {line!r}")
        word, base, decision, reason, confidence = parts
        if decision not in ("yes", "no"):
            sys.exit(f"verdict must be yes/no, got {decision!r} for {word!r}")
        if confidence not in CONFIDENCES:
            sys.exit(f"confidence must be one of {CONFIDENCES}, got {confidence!r} for {word!r}")
        verdicts[word] = Verdict(base, decision == "yes", reason, confidence)
    return verdicts


def append_verdicts(rows: list[tuple[str, Verdict]]) -> None:
    with VERDICTS_PATH.open("a") as fh:
        for word, v in rows:
            decision = "yes" if v.confirmed else "no"
            fh.write(f"{word}\t{v.base}\t{decision}\t{v.reason}\t{v.confidence}\n")


PROMPT = """You are grading word pairs for a daily word game that scores words by rarity.

Rare-looking derived forms break the game: "lactational" is scored far rarer than \
"lactation" purely because corpora rarely contain it, even though any player who \
knows "lactation" can bolt "-al" on. For each pair below, decide whether the WORD \
is a transparent derived form of the BASE -- same root, meaning still built out of \
the base's meaning, formed by an ordinary English affix.

Answer "yes" only when all of these hold:
  - the word and the base genuinely share a root (not just a spelling accident),
  - a competent English speaker who knows the base would recognise the word as \
"the base, plus an affix",
  - the word's meaning is still the base's meaning modified in the usual way for \
that affix.

Answer "no" when:
  - the shared letters are a coincidence ("outrage"/"rage", "deliver"/"liver", \
"mission"/"miss"),
  - the word has drifted into its own idea, so knowing the base would not get you \
there ("business"/"busy", "casualty"/"casual", "department"/"depart"),
  - the word is a technical or scientific term whose sense is not simply the \
base's ("sublimation"/"sublime"),
  - you are not sure. "No" is the safe answer: it leaves the game's existing score \
untouched.

Also report *why* and how sure you are:
  - "reason": for a yes, the affix class that makes it transparent (prefix-out, comparative, agent-noun, adjective-from-base, verb-from-base, abstract-noun, compound-suffix); for a no, the ground -- "coincidence" (unrelated roots), "wrong-base" (real derivation, but of a different word), "drifted" (meaning has moved), "technical" (specialist sense), or "unsure".
  - "confidence": "high", "medium", or "low". A "low" yes is discarded, so use it whenever you would rather leave the score alone.

Reply with one JSON array, one object per pair, in the same order, no prose:
[{"word": "...", "base": "...", "derived": true|false, "reason": "...", "confidence": "high"|"medium"|"low"}]

Pairs:
"""


def adjudicate(rows, model: str, batch_size: int, limit: int | None, dry_run: bool) -> None:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key and not dry_run:
        sys.exit(
            "ANTHROPIC_API_KEY is not set. Export a key, or run with --candidates "
            "and adjudicate out of band, appending rows to scripts/llm-base-forms.txt."
        )
    known = read_verdicts()
    pending = [(w, b) for w, b, *_ in rows if w not in known]
    if limit is not None:
        pending = pending[:limit]
    if not pending:
        print("nothing to adjudicate; every candidate already has a verdict", file=sys.stderr)
        return
    print(f"adjudicating {len(pending)} pairs in batches of {batch_size}", file=sys.stderr)

    for start in range(0, len(pending), batch_size):
        batch = pending[start : start + batch_size]
        listing = "\n".join(f"{w} <- {b}" for w, b in batch)
        if dry_run:
            print(PROMPT + listing)
            continue
        verdicts = ask(api_key, model, PROMPT + listing, batch)
        append_verdicts(verdicts)
        done = min(start + batch_size, len(pending))
        confirmed = sum(1 for _, v in verdicts if v.adjusts)
        print(f"  {done}/{len(pending)} ({confirmed} confirmed in this batch)", file=sys.stderr)


def ask(api_key: str, model: str, prompt: str, batch) -> list[tuple[str, Verdict]]:
    """One API call for one batch. A pair the model omits or mangles stays a 'no'."""
    body = json.dumps(
        {
            "model": model,
            "max_tokens": 8000,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode()
    request = urllib.request.Request(
        ANTHROPIC_URL,
        data=body,
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as err:
        sys.exit(f"Anthropic API error {err.code}: {err.read().decode()[:400]}")
    text = "".join(block.get("text", "") for block in payload.get("content", []))
    start, end = text.find("["), text.rfind("]")
    if start < 0 or end < 0:
        sys.exit(f"could not find a JSON array in the model's reply: {text[:400]!r}")
    parsed = json.loads(text[start : end + 1])
    decisions = {
        (item.get("word"), item.get("base")): item for item in parsed if isinstance(item, dict)
    }
    out: list[tuple[str, Verdict]] = []
    for word, base in batch:
        item = decisions.get((word, base))
        if item is None:
            # The model skipped it or renamed it: record a no rather than guess.
            out.append((word, Verdict(base, False, "unanswered", LOW_CONFIDENCE)))
            continue
        confidence = str(item.get("confidence", LOW_CONFIDENCE))
        out.append(
            (
                word,
                Verdict(
                    base,
                    bool(item.get("derived")),
                    str(item.get("reason", "unstated")),
                    confidence if confidence in CONFIDENCES else LOW_CONFIDENCE,
                ),
            )
        )
    return out


def compile_data(lex: Lexicon) -> None:
    """Write the confirmed pairs as two index arrays aligned with dictionary.json.

    Indices rather than strings for the same reason rarity.json is positional:
    this file ships to every player, and the words are already in the bundle.
    """
    verdicts = read_verdicts()
    words: list[int] = []
    bases: list[int] = []
    for word in sorted(w for w, v in verdicts.items() if v.adjusts):
        base = verdicts[word].base
        if word not in lex.index:
            sys.exit(f"{word!r} has a verdict but is not in dictionary.json")
        if base not in lex.index:
            sys.exit(f"base {base!r} for {word!r} is not in dictionary.json")
        # A base no more common than the word would be a no-op at best, and the
        # game's cap would ignore it anyway. Drop it so the payload stays honest.
        if lex.zipf(base) <= lex.adjusted_zipf(word):
            continue
        words.append(lex.index[word])
        bases.append(lex.index[base])
    OUT_PATH.write_text(json.dumps({"words": words, "bases": bases}) + "\n")
    total = len(verdicts)
    print(
        f"wrote {OUT_PATH.relative_to(ROOT)}: {len(words)} adjustments "
        f"from {total} verdicts ({total - len(words)} rejected, low-confidence, or no-ops)"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--candidates", action="store_true", help="print the prefiltered pairs")
    mode.add_argument("--adjudicate", action="store_true", help="ask Claude about new pairs")
    mode.add_argument("--compile", action="store_true", help="build the shipped JSON (default)")
    parser.add_argument("--min-score", type=float, default=DEFAULT_MIN_SCORE)
    parser.add_argument("--min-gap", type=float, default=DEFAULT_MIN_GAP)
    parser.add_argument("--min-base-zipf", type=float, default=DEFAULT_MIN_BASE_ZIPF)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH)
    parser.add_argument("--limit", type=int, help="stop after this many new pairs")
    parser.add_argument(
        "--dry-run", action="store_true", help="with --adjudicate, print prompts instead of calling"
    )
    args = parser.parse_args()

    lex = Lexicon()
    if args.compile or not (args.candidates or args.adjudicate):
        compile_data(lex)
        return

    rows = find_candidates(lex, args.min_score, args.min_gap, args.min_base_zipf)
    if args.candidates:
        known = read_verdicts()
        print("# word\tbase\tword score\tbase score\tzipf gap\tverdict")
        for word, base, word_score, base_score, gap in rows:
            verdict = "-" if word not in known else ("yes" if known[word].confirmed else "no")
            print(f"{word}\t{base}\t{word_score:.2f}\t{base_score:.2f}\t{gap:.2f}\t{verdict}")
        print(f"{len(rows)} candidates", file=sys.stderr)
        return

    adjudicate(rows, args.model, args.batch_size, args.limit, args.dry_run)


if __name__ == "__main__":
    main()
