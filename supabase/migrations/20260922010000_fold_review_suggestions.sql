-- A rejected fold gains a recommendation: not just "scoring it as that was
-- wrong" but "it should have been scored as this".
--
-- The original ledger had two answers, and two answers turned out to be one
-- short. A rejection is really two different findings wearing one badge:
--
--   * "timelessly" folds to "time", and should fold to "timeless" -- the chain
--     stopped one hop early. The word is a derivation and scoring it on its own
--     near-zero frequency would be as wrong as scoring it as "time", in the
--     other direction.
--   * "momser" folds to "mom" and is not a form of anything -- it should score
--     on its own data.
--
-- Exported, those go to different files: the first is an entry in
-- score-overrides.json, which pins a word to a reviewed base, and the second is
-- an entry in fold-exemptions.json, which stops the fold outright. The old
-- ledger could only say the second, so a reviewer who meant the first had their
-- answer turn into a word scoring as a Legend on the strength of nobody having
-- written it down. See scripts/export-fold-rejections.mjs for the two roads.
--
-- Null suggestion keeps its old meaning exactly -- "this should not fold" -- so
-- the column is additive and the rows already in the table are unchanged.

alter table public.fold_reviews
  add column if not exists suggested_base text;

comment on column public.fold_reviews.suggested_base is
  'On a rejection: the base the fold should have reached. Null means it should not fold at all.';

-- The game's own input rule, the same one `word` and `base` carry.
alter table public.fold_reviews
  drop constraint if exists fold_reviews_suggested_base_check;
alter table public.fold_reviews
  add constraint fold_reviews_suggested_base_check
  check (suggested_base is null or suggested_base ~ '^[a-z]{2,40}$');

-- A suggestion belongs to a rejection. On an approval the fold's own base is the
-- answer, and a second base sitting beside it would be a row contradicting
-- itself; a word folding to itself is not a fold.
alter table public.fold_reviews
  drop constraint if exists fold_reviews_suggestion_shape_check;
alter table public.fold_reviews
  add constraint fold_reviews_suggestion_shape_check
  check (
    (verdict = 'rejected' or suggested_base is null)
    and (suggested_base is null or suggested_base <> word)
  );

-- Both functions are dropped rather than replaced: one gains a column in its
-- returned table and the other a parameter, and `create or replace` may change
-- neither.
drop function if exists public.list_fold_reviews(integer);

create function public.list_fold_reviews(p_limit integer default 2000)
returns table (
  word text,
  base text,
  own_zipf numeric,
  base_zipf numeric,
  verdict text,
  suggested_base text,
  puzzle_date date,
  reviewed_at timestamptz
)
language sql
stable
as $$
  select r.word, r.base, r.own_zipf, r.base_zipf, r.verdict, r.suggested_base,
         r.puzzle_date, r.reviewed_at
  from public.fold_reviews r
  order by r.reviewed_at desc, r.word asc
  limit greatest(1, least(coalesce(p_limit, 2000), 10000));
$$;

comment on function public.list_fold_reviews(integer) is
  'Every reviewed fold, newest first, bounded. Read by api/fold-reviews.ts and scripts/export-fold-rejections.mjs.';

revoke all on function public.list_fold_reviews(integer) from public, anon, authenticated;
grant execute on function public.list_fold_reviews(integer) to service_role;

drop function if exists public.set_fold_review(text, text, numeric, numeric, date, text);

-- The suggestion defaults to null, so the six-argument call the previous
-- deployment makes still resolves while a deploy is in flight: it means what it
-- has always meant, which is a rejection with no recommendation attached.
create function public.set_fold_review(
  p_word text,
  p_base text,
  p_own_zipf numeric,
  p_base_zipf numeric,
  p_puzzle_date date,
  p_verdict text,
  p_suggested_base text default null
)
returns table (verdict text, suggested_base text)
language plpgsql
as $$
declare
  v_suggested text := nullif(btrim(coalesce(p_suggested_base, '')), '');
begin
  if p_verdict is null or btrim(p_verdict) = '' then
    delete from public.fold_reviews where word = p_word;
    return query select null::text, null::text;
    return;
  end if;
  -- An approval carries no suggestion, whatever was sent: the constraint would
  -- refuse the row, and refusing the verdict over a field that cannot apply to
  -- it would lose an answer the reviewer did give.
  if p_verdict <> 'rejected' then v_suggested := null; end if;
  if v_suggested = p_word then v_suggested := null; end if;

  insert into public.fold_reviews (
    word, base, own_zipf, base_zipf, puzzle_date, verdict, suggested_base, reviewed_at
  )
  values (
    p_word, p_base, p_own_zipf, p_base_zipf, p_puzzle_date, p_verdict, v_suggested, now()
  )
  on conflict (word) do update set
    -- The fold itself is re-stated on every write, not just the verdict: the
    -- rules move, and a verdict reached against one base must not be left
    -- sitting under another one.
    base = excluded.base,
    own_zipf = excluded.own_zipf,
    base_zipf = excluded.base_zipf,
    puzzle_date = excluded.puzzle_date,
    verdict = excluded.verdict,
    suggested_base = excluded.suggested_base,
    reviewed_at = now();

  return query select p_verdict, v_suggested;
end;
$$;

comment on function public.set_fold_review(text, text, numeric, numeric, date, text, text) is
  'Record a verdict and any recommended base, or delete the row when the verdict is null. Returns what is stored.';

revoke all on function public.set_fold_review(text, text, numeric, numeric, date, text, text)
  from public, anon, authenticated;
grant execute on function public.set_fold_review(text, text, numeric, numeric, date, text, text)
  to service_role;
