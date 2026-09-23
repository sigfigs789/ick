#!/usr/bin/env python3
"""Apply the audit's confirmed findings to the reviewed tables.

Everything here came out of the 2026-09-22 semantic audit of the corpus-era
fold: every fold reachable in the drops of 2026-09-28..30 was judged, and these
are the ones a human confirmed had landed on a word with a different meaning.
The `-ly` family is absent because it was fixed in the engine instead (see
LIQUID_STEM_START); what is left is the residue no rule should be written for.

A plain exemption is the tool wherever the word's true base is rarer than the
word, since a fold is a cap and an override onto a rarer base would do nothing.
An override is used where the true base is a real word worth naming.
"""
import json, pathlib

SINCE = "2026-09-28"

# word -> reason. Plain exemption: folds nowhere, and no chain may pass through.
EXEMPT = {
    # Lexicalised prefix compounds: the prefixed word is its own word now.
    "outback": "The Australian interior. Not a kind of `back`, and `outbacking` folded seven points down through it.",
    "outbreak": "An eruption of disease or war. `break` is its etymology, not its meaning.",
    "overtake": "To pass something moving. A sense of its own, not a kind of `take`.",
    "undertake": "To commit to a task. Not a kind of `take`; `undertaking` reached it through a chain of five hops.",
    "undertow": "The seaward current under a breaking wave. A noun in its own right, not a `tow`.",
    "overlock": "A sewing stitch that encloses a raw edge. Nothing to do with a `lock`.",
    "outwick": "A curling shot. Its `wick` is the bowls term, and the chain read the residue as `wicked`.",
    "overshower": "A shower passing overhead. `over` + `shower`, which the -er strip read as `overshow` + `-er`.",
    "outshower": "To out-shower. From `shower` the rainfall, not from `outshow`.",
    "overflower": "One who overflows. The -s chain reached `flowers`, the blooms.",
    "untoward": "Improper or unlucky. A fixed adjective, not the preposition `toward` negated.",
    "towardly": "Docile, compliant. An archaic adjective whose sense left `toward` centuries ago.",
    # Gerunds and participles whose sense has left the verb they look built on.
    "corking": "Excellent, splendid. The slang adjective, not the act of sealing a bottle.",
    "politicking": "Campaigning, built on `politics`. Not the adjective `politic`, which means prudent.",
    "barracking": "Jeering at a player. From the verb `barrack`, not the soldiers' `barracks`.",
    "broking": "Brokerage. From `broke` the verb stem of `broker`, not `broke` meaning penniless.",
    "woking": "Cooking in a wok. Read as the past tense `woke`.",
    "nowed": "Heraldic for knotted. Not `now` with a tense ending.",
    "specking": "From `speck`, a small spot. Not `spec`, short for specification.",
    "relicking": "Licking again. Not `relic`, and the chain went on to the plural `relics`.",
    "chacking": "A bird's call. `chac` is not its base.",
    "autodocking": "Docking automatically. Not built on `autodoc`.",
    "muckinger": "A handkerchief, in thieves' cant. Not a maker of `muck`.",
    # Verbs whose -se the -s rules strip as an inflection.
    "bellow": "To roar. `bellows` the airblower is a separate noun, and the reverse fold capped the verb at it.",
    "gallow": "To frighten, archaic. `gallows` is the hanging frame, not its plural.",
    "wick": "A cord in a candle, and the verb for drawing liquid. Not a form of `wicked`.",
    "yike": "A scuffle or argument. `yikes` is an interjection, not its plural.",
    "pretension": "Also the act of pre-tensioning. Its -ing and -ed forms are that sense, not a claim to importance.",
    # Plurals and lookalikes the -s rules overshoot.
    "howes": "Plural of `howe`, a hollow or barrow. Not `how`.",
    "lowes": "Plural of `lowe`, a flame. Not `low`.",
    "kines": "`kine` is the archaic plural of cow. Nothing to do with `kin`.",
    "kineses": "Plural of `kinesis`, a movement response. Read as `kines` and then `kin`.",
    "bowles": "Plural of `bowle`. Not `bowl`.",
    "showies": "Plural of `showie`, a showground worker. Not the adjective `showy`.",
    "rowies": "Plural of `rowie`, the Aberdeen roll. Not an adjective `rowy`.",
    "showees": "One shown something. `showe` is not a word it could be built on.",
    "followees": "One who is followed. `followe` is not a word.",
    "pensionees": "A pensioner. `pensione` is an Italian guesthouse.",
    "monokines": "Plural of `monokine`, a cytokine from a monocyte. Not the swimsuit `monokini`.",
    # Adjectives in -y on stems the -ly strip cannot keep whole, and which have
    # no comparative for LIQUID_STEM_START's paired test to find.
    "howly": "From `howl`. The -ly strip read it as `how`, and cost it 7.45 points.",
    "howlable": "Able to be howled. Reached `how` through `howly`.",
    "prowly": "From `prowl`. The -ly strip read it as `prow`, the front of a ship.",
    "hokiness": "From `hokey`. `hoki` is a fish.",
    "pokiness": "From `poky`. `pokies` are slot machines.",
    # Miscellaneous.
    "kinkable": "Able to kink. `kinky` has a sense of its own that this does not carry.",
    "unkinkable": "Not able to kink. Reached `kinky` through `unkinky`.",
    "akinete": "A thick-walled dormant cell. Not a noun form of `akinetic`.",
    "physiograph": "A recording instrument. The noun is not a form of the adjective `physiographic`.",
    "airshower": "A cascade of secondary cosmic-ray particles -- an air shower. Not a form of `airshow`.",
    "haymower": "A machine that mows hay. A `haymow` is the loft the hay is stored in.",
    "bloodflower": "A milkweed, *Asclepias curassavica*. Not a form of `bloodflow`.",
    "reflower": "To flower again. Read as `reflow` plus an agent -er.",
    "postshower": "After a shower. Not a form of `postshow`.",
    "reshower": "To shower again. Not `reshow`, which is to show again.",
    "stocking": "Hosiery. A noun of its own, not a form of `stock`; `stockings`, `stockinged` and `stockingless` all fold through it.",
}

# word -> (base, reason). Used where the true base is a word worth naming.
OVERRIDE = {}
for stem, gloss in [
    ("rowse", "to rouse"),
    ("blowse", "a ruddy-faced woman"),
    ("bowse", "to haul on a rope"),
    ("towse", "to tousle or handle roughly"),
    ("dowse", "to search for water with a rod"),
    ("chowse", "to dupe or swindle"),
    ("sowse", "a variant of `souse`"),
    ("frowse", "to look unkempt"),
]:
    short = stem[:-1]  # "rows" -- the reading the -es strip takes, and a word
    why = (
        f"A form of `{stem}`, {gloss}. The -es strip reads it as `{short}` and the "
        f"chain carries on to `{short[:-1]}`, which is a different word entirely."
    )
    OVERRIDE[f"{short}es"] = (stem, why)
    OVERRIDE[f"{short}ed"] = (stem, why)
    OVERRIDE[f"{short}ing"] = (stem, why)

REJECT = {
    "fowlest": ("misspelling", "A misspelling of `foulest`; `fowl` is a bird and has no superlative."),
}


def merge(path: str, additions: dict, build) -> None:
    p = pathlib.Path(path)
    data = json.loads(p.read_text())
    added = skipped = 0
    for word, payload in additions.items():
        if word in data:
            skipped += 1
            continue
        data[word] = build(payload)
        added += 1
    p.write_text(json.dumps({k: data[k] for k in sorted(data)}, indent=2) + "\n")
    print(f"{path}: +{added} ({skipped} already reviewed, left alone)")


merge("src/data/fold-exemptions.json", EXEMPT,
      lambda reason: {"since": SINCE, "reason": reason})
merge("src/data/score-overrides.json", OVERRIDE,
      lambda pair: {"base": pair[0], "reason": pair[1], "since": SINCE})
merge("src/data/word-rejections.json", REJECT,
      lambda pair: {"reason": pair[0], "since": SINCE, "note": pair[1]})
