-- A read-only door onto the live fold rejections, for the Reddit build.
--
-- A rejection at /folded-live makes a word score as itself on one puzzle rather
-- than as its common form, and the game applies it the moment it loads (see
-- src/game/liveFoldRejections.ts). The Reddit build plays the same puzzles and
-- shares one board with this site, so it has to price words the same way -- or
-- a Reddit player and a website player who banked the same word would sit on
-- that board at different scores.
--
-- Same shape as 20260911060000: `anon` still cannot read the table, and gets
-- execute on one `security definer` function returning what the game already
-- hands every player who opens the puzzle -- a word and the base it no longer
-- folds to. No who, no when.

create or replace function public.list_live_fold_rejections_public(p_date date)
returns table (word text, base text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.word, r.base
  from public.list_live_fold_rejections(p_date) r;
$$;

comment on function public.list_live_fold_rejections_public(date) is
  'Read-only live fold rejections for the Reddit build to import. Callable by anon.';

revoke all on function public.list_live_fold_rejections_public(date)
  from public, anon, authenticated;
-- service_role explicitly: a REVOKE from public takes its inherited grant too.
grant execute on function public.list_live_fold_rejections_public(date) to anon, service_role;
