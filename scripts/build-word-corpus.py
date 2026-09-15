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
  sources.bin one byte per word, bit flags indexed by SOURCE_ORDER
  zipf.bin    one byte per word: round(zipf * 32), 0 meaning no corpus attests it
  meta.json   counts, tag and source order, and the zipf scale, so the client
              decodes without hardcoding anything

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
#
# Every tag here is a lexical property of the word. Where a word *came from* is
# not one of those, so provenance lives in sources.bin instead: "we have no
# lexical data for this word" and "this word is an abbreviation" are different
# kinds of claim, and a runtime filter wants them separately.
TAG_ORDER = [
    "proper-noun",
    "capitalized-only",
    "obsolete",
    "archaic",
    "dated",
    "abbreviation",
    "misspelling",
]

# Bit order for sources.bin. Append only, and keep it to eight.
#
# This is what separates a vetted word from an unvetted one. A word absent from
# Wiktionary carries no tags at all -- not because it is clean, but because
# nothing described it. Norvig's Google Web 1T is the sharp edge: it attests
# 160,690 words no lexicon has, and most are crawl residue ("mxps", "emci",
# "travelglobe"). Without the source bits those are indistinguishable from a
# word Wiktionary vetted and found nothing wrong with.
SOURCE_ORDER = [
    "wiktionary",
    "dictionary",
    "macos_dict",
    "wordfreq",
    "norvig",
    "google_books",
    "datamuse",
    "curated",
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

# The three small hand-maintained lists share one "curated" bit; they are
# edited by the same review process and no filter needs to tell them apart.
CURATED_PATHS = [
    ROOT / "scripts" / "extra-words.txt",
    ROOT / "scripts" / "online-words.txt",
    ROOT / "scripts" / "playable-exemptions.txt",
]

SOURCE_LISTS = {
    "macos_dict": Path("/usr/share/dict/words"),
    "norvig": ROOT / "scripts" / "norvig-count-1w.txt",
    "google_books": ROOT / "scripts" / "google-books-counts.txt",
    "datamuse": ROOT / "scripts" / "datamuse-zipf.txt",
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
    sources = {name: load_list(path) for name, path in SOURCE_LISTS.items()}
    sources["curated"] = set().union(*(load_list(path) for path in CURATED_PATHS))
    sources["dictionary"] = {
        word for word in json.loads(DICTIONARY_PATH.read_text()) if WORD_RE.fullmatch(word)
    }
    sources["wiktionary"] = set(records)
    try:
        from wordfreq import get_frequency_dict

        sources["wordfreq"] = {
            w for w in get_frequency_dict("en", wordlist="best") if WORD_RE.fullmatch(w)
        }
    except ModuleNotFoundError:
        sys.exit("wordfreq is required; install it with: pip3 install --user wordfreq")

    universe = set().union(*sources.values())
    words = sorted(universe)
    index = {word: i for i, word in enumerate(words)}

    waterfall = FrequencyWaterfall()
    tag_bits = bytearray(len(words))
    source_bits = bytearray(len(words))
    zipf_bytes = bytearray(len(words))
    counts: collections.Counter = collections.Counter()
    source_counts: collections.Counter = collections.Counter()
    attested = 0
    membership = {name: sources[name] for name in SOURCE_ORDER}
    for word in words:
        record = records.get(word)
        # No record means no lexicon described this word, which is not itself a
        # property of the word -- sources.bin says so, and says by whose absence.
        mask = 0
        for tag in tags_for(record) if record else []:
            mask |= 1 << TAG_ORDER.index(tag)
            counts[tag] += 1
        tag_bits[index[word]] = mask
        source_mask = 0
        for bit, name in enumerate(SOURCE_ORDER):
            if word in membership[name]:
                source_mask |= 1 << bit
                source_counts[name] += 1
        source_bits[index[word]] = source_mask
        zipf = waterfall.zipf(word)
        if zipf is not None:
            attested += 1
            zipf_bytes[index[word]] = max(1, min(255, round(zipf * ZIPF_SCALE)))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "words.txt").write_text(front_code(words) + "\n")
    (args.out_dir / "tags.bin").write_bytes(bytes(tag_bits))
    (args.out_dir / "sources.bin").write_bytes(bytes(source_bits))
    (args.out_dir / "zipf.bin").write_bytes(bytes(zipf_bytes))
    (args.out_dir / "meta.json").write_text(
        json.dumps(
            {
                "count": len(words),
                "tagOrder": TAG_ORDER,
                "sourceOrder": SOURCE_ORDER,
                "zipfScale": ZIPF_SCALE,
                "attested": attested,
                "tagCounts": dict(sorted(counts.items())),
                "sourceCounts": dict(sorted(source_counts.items())),
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
    print("Sources:")
    for name, n in sorted(source_counts.items()):
        print(f"  {name:20s} {n}")
    print(f"Wrote {args.out_dir}")


if __name__ == "__main__":
    main()
