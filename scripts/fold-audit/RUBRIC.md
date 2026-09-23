# Fold judging rubric

WordInk scores a word by how rare it is. Before scoring, it **folds** a word onto
its base form and uses the base's rarity instead, so `running` is scored as
common because `run` is common. The fold is mechanical — it strips affixes by
spelling rule — so it can land on a word that merely *looks* like a base.

You are checking one thing: **does the proposed base mean the same thing as the
word?**

## Verdicts

`same` — the word is genuinely a form or derivative of the base, and carries the
base's core meaning. Scoring it as the base is right.
- `running` → `run`, `cats` → `cat`, `happiest` → `happy`
- `overthinkings` → `think` — a long mechanical derivation still *means* thinking
- `unhappiness` → `unhappy` — negation is part of the derivation, not a new sense
- Rare or ugly words are fine. `materialnesses` → `material` is `same`. You are
  not judging whether the word is good, only whether the base means the same.

`different` — the fold is wrong. Either the word is not built on that base at
all, or it is but has drifted to an unrelated meaning.
- `rehearse` → `hearse` — coincidental letters, no relation
- `momser` → `mom` — a Yiddish loanword, not `mom` + `-er`
- `bares` → `bar` — it is the plural of `bare`; the `-s` strip overshot
- `politic` → `politics` — related root, but not a form of that word
- `laterize` → `later` — to form laterite, not "more late"

`unsure` — genuinely ambiguous, or you do not know one of the words. Use it
rather than guessing; an `unsure` costs nothing and a wrong `same` hides a bug.

## The judgement to make

Ask: *if a player submitted this word and the game told them "scored as its
common form, X", would they accept it or file a bug?*

Do not reason about frequency, and do not assume a fold is right because the
words share letters — sharing letters is how the fold got here.

## Output format

One line per numbered pair, nothing else. No preamble, no code fences, no
summary:

```
<id>|<same|different|unsure>|<reason, at most 8 words>
```

Every id in the input gets exactly one line, in order.
