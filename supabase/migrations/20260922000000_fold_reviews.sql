-- A judgement on one fold: the word, the base its score came from, and whether
-- reading it that way was right.
--
-- The fold is the one part of the scoring nobody has ever reviewed a row at a
-- time. It is built out of rules -- strip a suffix, keep the candidates the
-- dictionary attests, take the most common -- and the rules are judged in
-- aggregate, by sweeping a band and reading the worst offenders (see the two
-- audit skills). That finds the rule that is wrong. It does not accumulate a
-- record of the individual calls, which is the thing both of this table's
-- readers want:
--
--   * `scripts/export-fold-rejections.mjs` turns the rejected rows into
--     `src/data/fold-exemptions.json`, which is what actually stops a fold in
--     the game. The export is deliberate rather than live: scoring is dated,
--     deterministic and offline, and a puzzle whose scores depend on a table
--     somebody can edit mid-day is a puzzle that cannot be replayed. So a
--     rejection here is a reviewed verdict waiting to be shipped, not a switch.
--
--   * a labelled set for a model to learn the judgement from. That needs both
--     answers -- a file of nothing but rejections says what a bad fold looks
--     like and nothing about what a good one looks like -- which is why an
--     approval is stored rather than being left as the absence of a rejection.
--
-- One row per word, because a word has one fold under the rules in force and a
-- second look at it is a correction rather than a second opinion. The zipfs are
-- stored alongside rather than being looked up again later: they are what the
-- reviewer was actually shown, and the rules they came from move.

create table if not exists public.fold_reviews (
  -- The game's own input rule, so nothing but a playable spelling lands here.
  word text primary key check (word ~ '^[a-z]{2,40}$'),
  -- The form the score came from -- the end of the chain, not a link in it.
  base text not null check (base ~ '^[a-z]{2,40}$'),
  -- What the reviewer saw: the word's own frequency, and the base's. Nullable
  -- because the deep tail has words no corpus attests, and the sentinel the game
  -- uses for that is a number this table has no business re-deriving.
  own_zipf numeric,
  base_zipf numeric,
  verdict text not null check (verdict in ('approved', 'rejected')),
  -- The puzzle the word was up for when it was reviewed. Context for the export
  -- and for anybody reading the set later; nothing keys off it.
  puzzle_date date,
  reviewed_at timestamptz not null default now()
);

comment on table public.fold_reviews is
  'One reviewed fold: word, the base it scored as, and whether that was right. Read by api/fold-reviews.ts and scripts/export-fold-rejections.mjs.';

alter table public.fold_reviews enable row level security;

-- RLS on with no policies denies every anon and authenticated request. The
-- service role bypasses it and is granted explicitly, because a REVOKE hands
-- nothing to anybody -- a grant inherited today is a grant that vanishes the
-- moment the default changes.
revoke all on public.fold_reviews from anon, authenticated;
grant select, insert, update, delete on public.fold_reviews to service_role;

-- Every verdict reached so far, newest first.
--
-- The whole set rather than a page of it, bounded. Two callers want all of it:
-- the page, which subtracts the judged words from the batch it is about to show,
-- and the export, which has to see every rejection or it would drop exemptions
-- that are already shipped. A page-sized read would make both of them wrong in
-- the same quiet way.
create or replace function public.list_fold_reviews(p_limit integer default 2000)
returns table (
  word text,
  base text,
  own_zipf numeric,
  base_zipf numeric,
  verdict text,
  puzzle_date date,
  reviewed_at timestamptz
)
language sql
stable
as $$
  select r.word, r.base, r.own_zipf, r.base_zipf, r.verdict, r.puzzle_date, r.reviewed_at
  from public.fold_reviews r
  order by r.reviewed_at desc, r.word asc
  limit greatest(1, least(coalesce(p_limit, 2000), 10000));
$$;

comment on function public.list_fold_reviews(integer) is
  'Every reviewed fold, newest first, bounded. Read by api/fold-reviews.ts.';

revoke all on function public.list_fold_reviews(integer) from public, anon, authenticated;
grant execute on function public.list_fold_reviews(integer) to service_role;

-- Record a verdict, or take one back.
--
-- A null verdict deletes the row, so "not judged yet" is the absence of a row
-- rather than a third value every reader has to know about -- the same shape
-- `set_feedback_mark` uses, and for the same reason.
--
-- Returns what is now stored. A value rather than void so the page can draw the
-- database's answer instead of its own optimism: a control that reports what it
-- asked for is a control that will eventually lie about what was saved.
create or replace function public.set_fold_review(
  p_word text,
  p_base text,
  p_own_zipf numeric,
  p_base_zipf numeric,
  p_puzzle_date date,
  p_verdict text
)
returns text
language plpgsql
as $$
begin
  if p_verdict is null or btrim(p_verdict) = '' then
    delete from public.fold_reviews where word = p_word;
    return null;
  end if;
  insert into public.fold_reviews (word, base, own_zipf, base_zipf, puzzle_date, verdict, reviewed_at)
  values (p_word, p_base, p_own_zipf, p_base_zipf, p_puzzle_date, p_verdict, now())
  on conflict (word) do update set
    -- The fold itself is re-stated on every write, not just the verdict: the
    -- rules move, and a verdict reached against one base must not be left
    -- sitting under another one.
    base = excluded.base,
    own_zipf = excluded.own_zipf,
    base_zipf = excluded.base_zipf,
    puzzle_date = excluded.puzzle_date,
    verdict = excluded.verdict,
    reviewed_at = now();
  return p_verdict;
end;
$$;

revoke all on function public.set_fold_review(text, text, numeric, numeric, date, text)
  from public, anon, authenticated;
grant execute on function public.set_fold_review(text, text, numeric, numeric, date, text)
  to service_role;
