# Fold judging — exceptions only

WordInk scores a word by how rare it is. Before scoring it **folds** the word
onto its base form and prices it as that base, so `running` is common because
`run` is. The fold is mechanical — it strips affixes by spelling rule — so it
can land on a word that merely *looks* like a base.

You are given a list of `word` → `base` pairs. Judge every one. **Report only
the ones that are wrong or that you are unsure of.** Say nothing about the pairs
you accept; silence means you judged it and it was fine.

## What is fine (say nothing)

- `running` → `run`, `cats` → `cat`, `happiest` → `happy`
- `overthinkings` → `think` — a long mechanical derivation still means thinking
- `unhappiness` → `unhappy` — negation is part of the derivation
- `materialnesses` → `material` — rare and ugly is not wrong
- folding onto a plural or inflection of the right word: `lesionless` →
  `lesions` is fine, it is still the same word

## What to report

**`different`** — the fold is wrong. Either the word is not built on that base,
or it is but has drifted to an unrelated meaning.
- `rehearse` → `hearse` — coincidental letters
- `momser` → `mom` — a Yiddish loanword, not `mom` + `-er`
- `bares` → `bar` — it is the plural of `bare`; the `-s` strip overshot
- `undertow` → `tow` — a current, not a kind of towing
- `scowly` → `scow` — from `scowl`; the `-ly` strip ate the l

**`unsure`** — genuinely ambiguous, or you do not know one of the words.

## The question to ask

*If a player submitted this word and the game said "scored as its common form,
X", would they accept it or file a bug?*

Do not reason about frequency. Do not assume a fold is right because the words
share letters — sharing letters is how the fold got here.

## Output

One line per **reported** pair, nothing else:

```
<id>|<different|unsure>|<reason, at most 8 words>
```

Then, as the final line and always:

```
JUDGED <n>
```

where `<n>` is how many pairs you actually read. This must equal the number of
input rows. A batch that reports nothing but judged everything writes only the
`JUDGED` line.
