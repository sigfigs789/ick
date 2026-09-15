#!/usr/bin/env python3
"""Build WordInk's expansive, unfiltered word corpus.

Unlike import-wiktionary-words.py -- which decides what is playable at build
time and throws the rest away -- this keeps every English headword it can find
and records *why* a word might be ineligible as a tag. Game modes then filter at
runtime: the daily drop can demand an untagged, attested word while a Freeform
week admits proper nouns or unattested coinages, all from one corpus.

Nothing here is a judgement about playability. A tag is an observation.

Sources, unioned:
  - Wiktionary (Wiktextract English extract) -- headwords, part of speech, tags
  - wordfreq / Norvig / Google Books / Datamuse -- the rarity waterfall
  - the macOS system dictionary and the repo's own curated lists

Outputs (src/data/corpus/):
  words.txt   front-coded word list, one per line: shared-prefix length as a
              single char (chr(48+n)) followed by the remaining suffix
  tags.bin    one byte per word, bit flags indexed by TAG_ORDER
  zipf.bin    one byte per word: round(zipf * 32), 0 meaning no corpus attests it
  meta.json   counts, tag order, and the zipf scale, so the client decodes
              without hardcoding anything

Derived from Wiktionary; the data stays CC BY-SA 4.0 (see meta.json).

Run:
    python3 scripts/build-word-corpus.py --source path/to/english.jsonl
    python3 scripts/build-word-corpus.py            # downloads the extract
"""
import argparse
import collections
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from frequency import FrequencyWaterfall

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "src" / "data" / "corpus"
SOURCE_URL = "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
WORD_RE = re.compile(r"^[a-z]+$")

# Bit order for tags.bin. Append only -- the client decodes by index.
TAG_ORDER = [
    "proper-noun",
    "capitalized-only",
    "obsolete",
    "archaic",
    "dated",
    "abbreviation",
    "misspelling",
    "not-in-wiktionary",
]
ZIPF_SCALE = 32  # zipf.bin stores round(zipf * 32); 0 means unattested

NAME_POS = {"name"}
ABBR_POS = {"abbrev"}
STATUS_SEVERITY = {"obsolete": 3, "archaic": 2, "dated": 1}
SEVERITY_REASON = {3: "obsolete", 2: "archaic", 1: "dated"}
ABBREV_TAGS = {"abbreviation", "initialism", "acronym"}
MISSPELLING_TAGS = {"misspelling", "pronunciation-spelling"}

# The shipping dictionary is a source in its own right: ~5k ESDB-derived
# inflections ("absentmindednesses") appear in no external corpus, and dropping
# them would un-play words the game already accepts.
DICTIONARY_PATH = ROOT / "src" / "data" / "dictionary.json"

CURATED_LISTS = {
    "extra_words": ROOT / "scripts" / "extra-words.txt",
    "online_words": ROOT / "scripts" / "online-words.txt",
    "exemptions": ROOT / "scripts" / "playable-exemptions.txt",
    "macos_dict": Path("/usr/share/dict/words"),
    "norvig": ROOT / "scripts" / "norvig-count-1w.txt",
    "google_books": ROOT / "scripts" / "google-books-counts.txt",
}


def open_source(source: Path | None):
    """The Wiktextract English extract, from disk or over the network."""
    if source:
        return open(source, encoding="utf-8")
    request = Request(SOURCE_URL, headers={"User-Agent": "WordInk corpus builder (wordink.app)"})
    return urlopen(request, timeout=120)


def read_wiktionary(source: Path | None) -> tuple[dict, int, collections.Counter]:
    """Per-headword lexical data, keyed by the *lower-cased* headword.

    Case is not a filter here: "Anatolian" is kept as "anatolian" and merely
    noted as capitalized-only. It stays a separate signal because Wiktionary
    uses case to keep distinct entries apart ("polish" vs "Polish"), so a word
    seen lower-case even once is never marked capitalized-only.
    """
    records: dict[str, dict] = {}
    entries = 0
    shape = collections.Counter()
    stream = open_source(source)
    for line in stream:
        if isinstance(line, bytes):
            line = line.decode("utf-8")
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if entry.get("lang_code") != "en":
            continue
        entries += 1
        raw = entry.get("word", "")
        word = raw.lower()
        if not WORD_RE.fullmatch(word):
            # Phrases and hyphenates can't be typed into the grid; count them so
            # the build reports what it left on the table.
            shape["multi_word" if " " in raw else "hyphenated" if "-" in raw else "other"] += 1
            continue
        record = records.setdefault(
            word, {"pos": set(), "sev": [], "abbrev": [], "misspelling": [], "caps_only": True}
        )
        if raw == word:
            record["caps_only"] = False
        pos = entry.get("pos", "")
        record["pos"].add(pos)
        if pos in NAME_POS or pos in ABBR_POS:
            continue
        entry_tags = set(entry.get("tags") or [])
        for sense in entry.get("senses") or [{}]:
            tags = set(sense.get("tags") or []) | entry_tags
            record["sev"].append(max((STATUS_SEVERITY.get(t, 0) for t in tags), default=0))
            record["abbrev"].append(bool(tags & ABBREV_TAGS))
            record["misspelling"].append(bool(tags & MISSPELLING_TAGS))
    stream.close()
    return records, entries, shape


def tags_for(record: dict) -> list[str]:
    """Every observation that might disqualify a headword. Never a verdict.

    A word with no ordinary part of speech is only a name or an abbreviation.
    Otherwise the sense-level tags decide, and only unanimously: one live sense
    is enough to keep a word out of the obsolete or misspelling buckets.
    """
    tags: list[str] = []
    ordinary = record["pos"] - NAME_POS - ABBR_POS
    if not ordinary:
        if record["pos"] & NAME_POS:
            tags.append("proper-noun")
        if record["pos"] & ABBR_POS:
            tags.append("abbreviation")
    elif record["sev"]:
        if all(record["abbrev"]):
            tags.append("abbreviation")
        if all(record["misspelling"]):
            tags.append("misspelling")
        if all(s >= 1 for s in record["sev"]):
            tags.append(SEVERITY_REASON[min(record["sev"])])
    if record["caps_only"]:
        tags.append("capitalized-only")
    return tags


def load_list(path: Path) -> set[str]:
    """Pure a-z words from a plain or `word<TAB>count` list."""
    words: set[str] = set()
    if not path.exists():
        return words
    for line in path.read_text(errors="ignore").splitlines():
        word = line.partition("\t")[0].strip().lower()
        if word and not word.startswith("#") and WORD_RE.fullmatch(word):
            words.add(word)
    return words


def front_code(words: list[str]) -> str:
    """Prefix-compress a sorted list: shared-prefix length, then the suffix.

    The length is one character (chr(48 + n), capped at 35) so the client can
    decode with a single charCodeAt per line and no delimiter scanning.
    """
    lines = []
    previous = ""
    for word in words:
        shared = 0
        for a, b in zip(previous, word):
            if a != b:
                break
            shared += 1
        shared = min(shared, 35)
        lines.append(chr(48 + shared) + word[shared:])
        previous = word
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the expansive tagged word corpus.")
    parser.add_argument("--source", type=Path, help="local Wiktextract English .jsonl")
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    args = parser.parse_args()

    records, entries, shape = read_wiktionary(args.source)
    extra = {name: load_list(path) for name, path in CURATED_LISTS.items()}
    extra["dictionary"] = {
        word for word in json.loads(DICTIONARY_PATH.read_text()) if WORD_RE.fullmatch(word)
    }
    try:
        from wordfreq import get_frequency_dict

        extra["wordfreq"] = {w for w in get_frequency_dict("en", wordlist="best") if WORD_RE.fullmatch(w)}
    except ModuleNotFoundError:
        sys.exit("wordfreq is required; install it with: pip3 install --user wordfreq")

    universe = set(records).union(*extra.values())
    words = sorted(universe)
    index = {word: i for i, word in enumerate(words)}

    waterfall = FrequencyWaterfall()
    tag_bits = bytearray(len(words))
    zipf_bytes = bytearray(len(words))
    counts: collections.Counter = collections.Counter()
    attested = 0
    for word in words:
        record = records.get(word)
        tags = tags_for(record) if record else ["not-in-wiktionary"]
        mask = 0
        for tag in tags:
            mask |= 1 << TAG_ORDER.index(tag)
            counts[tag] += 1
        tag_bits[index[word]] = mask
        zipf = waterfall.zipf(word)
        if zipf is not None:
            attested += 1
            zipf_bytes[index[word]] = max(1, min(255, round(zipf * ZIPF_SCALE)))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "words.txt").write_text(front_code(words) + "\n")
    (args.out_dir / "tags.bin").write_bytes(bytes(tag_bits))
    (args.out_dir / "zipf.bin").write_bytes(bytes(zipf_bytes))
    (args.out_dir / "meta.json").write_text(
        json.dumps(
            {
                "count": len(words),
                "tagOrder": TAG_ORDER,
                "zipfScale": ZIPF_SCALE,
                "attested": attested,
                "tagCounts": dict(sorted(counts.items())),
                "sources": sorted(extra) + ["wiktionary"],
                "license": f"Derived from Wiktionary, CC BY-SA 4.0 ({LICENSE_URL})",
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )

    print(f"Read {entries} English Wiktionary entries ({sum(shape.values())} unusable shapes: {dict(shape)})")
    print(f"Corpus: {len(words)} words, {attested} attested, {len(words) - attested} unattested")
    for tag, n in sorted(counts.items()):
        print(f"  {tag:20s} {n}")
    print(f"Wrote {args.out_dir}")


if __name__ == "__main__":
    main()
