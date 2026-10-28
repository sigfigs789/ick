# Judging the suggested-words queue

You are judging the words players have suggested for WordInk's dictionary (the
untriaged rows on /suggested-words). Read `.tmp/facts.json`: one entry per word,
with what the game already makes of it under today's rules.

For **every** word in it, decide `accept` or `reject`, and write all the verdicts
to `.tmp/verdicts.json` as a JSON array:

```json
[
  { "word": "fremen", "verdict": "accept", "reason": "The desert people of Dune; a well-known proper noun, correctly spelled." },
  { "word": "ashawaganda", "verdict": "reject", "reason": "Misspelling of ashwagandha." }
]
```

`reason` is one or two plain sentences a player could read. It goes in the pull
request, under the word.

## Estimating its frequency

When a word's `measuredZipf` is `null` -- no corpus measures it -- also give your
best estimate of its Zipf frequency as `"zipf"` (a number, two decimals at most),
whatever the verdict:

```json
{ "word": "eremition", "verdict": "accept", "reason": "...", "zipf": 0.4 }
```

Zipf is log10 of occurrences per billion words: 3 is once per million, 2 is once per ten million (`diaphanous` 1.97), 1 is once per
hundred million, 0 and below is the deep tail of words a dictionary holds but
almost nobody writes. Judge by how often the word is actually used in print and
online, not by how long or learned it looks; a well-known brand or a coinage that
went viral can be common. Leave `zipf` out when `measuredZipf` has a value.

## The rule: when in doubt, accept

Rejecting takes a word away from a player who asked for it; accepting a rare but
real word costs nothing (a rare word scoring rare is the game working). So:

**Accept** a word that is genuinely used in English and spelled the way it is
written, including:

- rare, technical, regional, dialect, slang, poetic or literary words;
- archaic, obsolete or Old/Middle English words that have a dictionary entry
  (Wiktionary, OED, Merriam-Webster, Collins) -- age is not a fault;
- proper nouns, brand names and names from books, films and games, when they
  are well known and correctly spelled (allowed since 2026-10-24);
- a word that already plays (`alreadyPlayable: true`): accept it, and say it
  already plays -- the player was right that it belongs.

**Reject** only when one of these is clearly true, and name which:

- **Misspelling**: a spelling of another word. Name the word it means
  ("Misspelling of ashwagandha.").
- **Not a word**: invented, a joke, or a keyboard mash, with no dictionary entry
  and no real usage you can find.
- **Not written solid**: a phrase run together ("muaythai") that English writes
  as two words or hyphenated.
- **Not English**: a foreign word with no English usage.
- **Offensive**: a slur or a word whose only use is to demean.

## Checking

- Use the facts first: `corpus.sources` lists the lexicons that know the word;
  `reviewedRejection` is a verdict the repo already holds; `standard`/`freeform`
  say whether it plays now and why not.
- For any word the facts do not settle, look it up with WebSearch/WebFetch
  (Wiktionary, Merriam-Webster, OED, Collins, Google Books) before rejecting it.
  Never reject a word only because the game does not know it -- that is why it
  was suggested.
- Every word in `.tmp/facts.json` must appear exactly once in
  `.tmp/verdicts.json`, lower-case, spelled exactly as it is in the facts.

Do not change any other file, and do not run git or gh. Work in the foreground:
do not start background tasks or subagents.
