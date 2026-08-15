#!/usr/bin/env python3
"""Per-word lexical classification for the incremental "add a word" flows.

The bulk pipeline tags the whole dictionary from the Wiktextract dump (see
import-wiktionary-words.py / wiktionary-reasons.json). That file can't cover a
brand-new candidate that Wiktextract never listed, so when we add words one at a
time -- the "Add a word" action and the online rare-word discovery -- we also ask
per-word sources whether the candidate is really an ordinary, current English
word or something the game excludes (a proper noun, an abbreviation, or a word
that has fallen out of use).

Sources, in order of authority:
  1. wiktionary-reasons.json  -- the local Wiktextract bulk map (free, offline).
  2. Merriam-Webster          -- Collegiate + Medical references. Authoritative
                                 part of speech (`fl`) and status labels (`sls`:
                                 archaic/obsolete). Needs MW_COLLEGIATE_KEY and
                                 MW_MEDICAL_KEY (free, non-commercial). Skipped
                                 gracefully when unset.
  3. Datamuse `md=p`          -- part of speech, free/no-key.
  4. Free Dictionary API      -- existence + part of speech fallback, free/no-key.

classify(word) resolves these into at most one rejection reason, matching the
reasons the bulk pipeline and the client already use. Merriam-Webster is trusted
over the bulk map when it has an entry (it is edited and current); the bulk map
is the fallback when MW has never heard of the word.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WIKTIONARY_REASONS_PATH = ROOT / "scripts" / "wiktionary-reasons.json"
ENV_PATH = ROOT / ".env"

# Rejection reasons that keep a candidate out of the game, strongest first. Kept
# in sync with REASON_PRIORITY in generate-data.py and the client's messages.
DISQUALIFYING = {"proper-noun", "abbreviation", "name-or-abbreviation", "obsolete", "archaic", "dated"}
REASON_PRIORITY = {
    "dated": 1,
    "archaic": 2,
    "obsolete": 3,
    "name-or-abbreviation": 4,
    "proper-noun": 5,
    "abbreviation": 6,
}

# Merriam-Webster functional labels that are not ordinary words.
MW_NAME_FLS = {"geographical name", "biographical name", "trademark"}
MW_ABBR_FLS = {"abbreviation"}
# Merriam-Webster sense status labels that mark a sense as out of current use.
MW_STATUS_SEVERITY = {"obsolete": 3, "archaic": 2}
USER_AGENT = "WordInk word-tagger (wordink.app)"


def load_env() -> None:
    """Populate os.environ from a local .env, without overriding real env vars."""
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def _load_reasons() -> dict[str, str]:
    if not WIKTIONARY_REASONS_PATH.exists():
        return {}
    grouped = json.loads(WIKTIONARY_REASONS_PATH.read_text())
    return {word: reason for reason, words in grouped.items() for word in words}


_WIKTIONARY_REASONS: dict[str, str] | None = None


def bulk_reason(word: str) -> str | None:
    """The Wiktextract bulk reason for a word, or None. Loaded once and cached."""
    global _WIKTIONARY_REASONS
    if _WIKTIONARY_REASONS is None:
        _WIKTIONARY_REASONS = _load_reasons()
    return _WIKTIONARY_REASONS.get(word)


def _get_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


def _status_severity(labels) -> int:
    """Highest out-of-use severity among a list of status labels (0 = current)."""
    return max((MW_STATUS_SEVERITY.get(label, 0) for label in (labels or [])), default=0)


def _mw_sense_severities(entry: dict) -> list[int]:
    """Out-of-use severity for each sense of an MW entry (0 = in current use).

    A status label can sit on the sense itself (`["sense", {"sls": [...]}]`) or on
    the whole definition block (`def[].sls`, which applies to every sense in that
    block -- e.g. "erst" is marked archaic there, not on the sense). Each sense
    inherits the stronger of the two.
    """
    severities: list[int] = []
    for block in entry.get("def", []):
        block_severity = _status_severity(block.get("sls"))
        found_sense = False

        def walk(node) -> None:
            nonlocal found_sense
            if isinstance(node, list):
                if len(node) == 2 and node[0] == "sense" and isinstance(node[1], dict):
                    found_sense = True
                    severities.append(max(block_severity, _status_severity(node[1].get("sls"))))
                else:
                    for item in node:
                        walk(item)
            elif isinstance(node, dict):
                for value in node.values():
                    walk(value)

        walk(block.get("sseq", []))
        if not found_sense:
            severities.append(block_severity)
    return severities


def mw_classify(word: str) -> tuple[str, list[str]]:
    """Merriam-Webster verdict for a word: (verdict, parts-of-speech).

    verdict is 'unknown' (MW has no entry / no key), 'playable' (has an ordinary
    current sense), or a rejection reason. Only entries whose headword matches the
    query are considered -- MW also returns related words (e.g. "Burr" for
    "aaron") that must be ignored.
    """
    load_env()
    lookups = [
        ("collegiate", os.environ.get("MW_COLLEGIATE_KEY")),
        ("medical", os.environ.get("MW_MEDICAL_KEY")),
    ]
    entries: list[dict] = []
    for reference, key in lookups:
        if not key:
            continue
        url = (
            f"https://dictionaryapi.com/api/v3/references/{reference}/json/"
            f"{urllib.parse.quote(word)}?key={key}"
        )
        try:
            data = _get_json(url)
        except (urllib.error.URLError, ValueError, TimeoutError):
            continue  # treat a source failure as "no opinion", never fatal
        for entry in data:
            if not isinstance(entry, dict):
                continue  # a list of suggestion strings -> word not found
            stem = entry.get("meta", {}).get("id", "").split(":")[0]
            if stem.lower() == word.lower():
                entries.append(entry)

    if not entries:
        return "unknown", []

    pos: set[str] = set()
    has_ordinary = has_name = has_abbr = False
    ordinary_severities: list[int] = []
    for entry in entries:
        fl = entry.get("fl") or ""
        pos.add(fl)
        stem = entry.get("meta", {}).get("id", "").split(":")[0]
        if fl in MW_ABBR_FLS:
            has_abbr = True
        elif fl in MW_NAME_FLS or (stem and stem != stem.lower()):
            has_name = True
        else:
            has_ordinary = True
            ordinary_severities.extend(_mw_sense_severities(entry) or [0])

    if has_ordinary:
        if ordinary_severities and all(s >= 1 for s in ordinary_severities):
            # Every ordinary sense is out of use; mildest register wins.
            return ("archaic" if min(ordinary_severities) == 2 else "obsolete", sorted(pos))
        return "playable", sorted(pos)
    if has_name and has_abbr:
        return "name-or-abbreviation", sorted(pos)
    if has_name:
        return "proper-noun", sorted(pos)
    if has_abbr:
        return "abbreviation", sorted(pos)
    return "unknown", sorted(pos)


def datamuse_pos(word: str) -> list[str]:
    """Datamuse part-of-speech tags for an exact word (n/v/adj/adv/u), or []."""
    query = urllib.parse.urlencode({"sp": word, "md": "p", "max": 1})
    try:
        data = _get_json(f"https://api.datamuse.com/words?{query}")
    except (urllib.error.URLError, ValueError, TimeoutError):
        return []
    for entry in data:
        if entry.get("word") == word:
            return [tag for tag in entry.get("tags", []) if tag in {"n", "v", "adj", "adv", "u"}]
    return []


def free_dictionary_pos(word: str) -> list[str]:
    """Parts of speech from the free Dictionary API (Wiktionary-backed), or []."""
    url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{urllib.parse.quote(word)}"
    try:
        data = _get_json(url)
    except (urllib.error.URLError, ValueError, TimeoutError):
        return []
    if not isinstance(data, list):
        return []
    pos = {m.get("partOfSpeech") for entry in data for m in entry.get("meanings", [])}
    return sorted(p for p in pos if p)


def classify(word: str) -> dict:
    """Resolve every source into at most one rejection reason for a word.

    Returns {word, reason, disqualified, sources}. `reason` is None when the word
    is an acceptable ordinary current word. Merriam-Webster is authoritative when
    it has an entry; otherwise the Wiktextract bulk map decides, and Datamuse /
    Free Dictionary contribute part-of-speech evidence for diagnostics.
    """
    word = word.strip().lower()
    bulk = bulk_reason(word)
    mw_verdict, mw_pos = mw_classify(word)
    dm_pos = datamuse_pos(word)
    fallback_pos = free_dictionary_pos(word) if mw_verdict == "unknown" and not dm_pos else []

    if mw_verdict == "playable":
        reason = None  # MW has a current ordinary sense -> trust it over the bulk map
    elif mw_verdict != "unknown":
        reason = mw_verdict
    else:
        reason = bulk  # MW never heard of it; fall back to Wiktextract

    return {
        "word": word,
        "reason": reason,
        "disqualified": reason in DISQUALIFYING,
        "sources": {
            "wiktextract": bulk,
            "merriam_webster": mw_verdict,
            "mw_pos": mw_pos,
            "datamuse_pos": dm_pos,
            "free_dictionary_pos": fallback_pos,
        },
    }


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("usage: word_tags.py WORD [WORD ...]")
    for word in sys.argv[1:]:
        result = classify(word)
        verdict = result["reason"] or "OK (playable)"
        source = result["sources"]
        print(
            f"{result['word']:20s} -> {verdict:20s} "
            f"[mw={source['merriam_webster']} wiktextract={source['wiktextract']} "
            f"mw_pos={source['mw_pos']} datamuse={source['datamuse_pos']}]"
        )


if __name__ == "__main__":
    main()
