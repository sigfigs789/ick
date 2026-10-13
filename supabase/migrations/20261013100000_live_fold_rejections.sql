-- A fold rejected live, for one puzzle: from the moment it is written, every
-- player who opens that puzzle scores the word on its own frequency.
--
-- The other fold ledger, `fold_reviews`, is deliberately not live: a rejection
-- there is a verdict waiting for a script and a deploy (see
-- scripts/export-fold-rejections.mjs), because scoring is dated and offline.
-- This table is the exception to that, asked for on purpose and kept narrow:
-- one puzzle, one word, a switch. The page at /folded-live writes it; the game
-- reads it whenever a Standard puzzle is opened, rescores any word of the
-- player's that it names, and tells them so.
--
-- Scoped by puzzle rather than by word. A fold that is wrong on one drop is
-- usually wrong on every drop, but "usually" is the kind of judgement the
-- reviewed ledger is for, with a diff somebody reads. This one changes scores
-- people already hold, so it changes exactly the puzzle the reviewer was
-- looking at and nothing else.
--
-- A row is a rejection; taking one back deletes the row, so "not rejected" is
-- the absence of a row rather than a third value every reader has to know
-- about -- the same shape `set_fold_review` uses.

create table if not exists public.live_fold_rejections (
  puzzle_date date not null,
  -- The game's own input rule, so nothing but a playable spelling lands here.
  word text not null check (word ~ '^[a-z]{2,40}$'),
  -- The form the word was scored as when it was rejected: what the player's
  -- notice names. Stored rather than re-derived because the fold rules move.
  base text not null check (base ~ '^[a-z]{2,40}$'),
  rejected_at timestamptz not null default now(),
  primary key (puzzle_date, word)
);

comment on table public.live_fold_rejections is
  'Folds rejected live at /folded-live: on this puzzle, this word scores on its own frequency. Read by api/folded-live.ts.';

alter table public.live_fold_rejections enable row level security;

-- RLS on with no policies denies every anon and authenticated request. The
-- service role bypasses it and is granted explicitly, because a REVOKE hands
-- nothing to anybody.
revoke all on public.live_fold_rejections from anon, authenticated;
grant select, insert, update, delete on public.live_fold_rejections to service_role;

-- Every live rejection on one puzzle.
create or replace function public.list_live_fold_rejections(p_date date)
returns table (word text, base text, rejected_at timestamptz)
language sql
stable
as $$
  select r.word, r.base, r.rejected_at
  from public.live_fold_rejections r
  where r.puzzle_date = p_date
  order by r.word asc
  limit 1000;
$$;

comment on function public.list_live_fold_rejections(date) is
  'Every live fold rejection on one puzzle. Read by api/folded-live.ts.';

revoke all on function public.list_live_fold_rejections(date) from public, anon, authenticated;
grant execute on function public.list_live_fold_rejections(date) to service_role;

-- Reject a fold on one puzzle, or take the rejection back. Returns whether the
-- word is rejected now, so the page draws the database's answer rather than
-- its own optimism.
create or replace function public.set_live_fold_rejection(
  p_date date,
  p_word text,
  p_base text,
  p_rejected boolean
)
returns boolean
language plpgsql
as $$
begin
  if not coalesce(p_rejected, false) then
    delete from public.live_fold_rejections where puzzle_date = p_date and word = p_word;
    return false;
  end if;
  insert into public.live_fold_rejections (puzzle_date, word, base, rejected_at)
  values (p_date, p_word, p_base, now())
  on conflict (puzzle_date, word) do update set
    base = excluded.base,
    rejected_at = now();
  return true;
end;
$$;

comment on function public.set_live_fold_rejection(date, text, text, boolean) is
  'Reject a fold on one puzzle, or delete the rejection. Returns whether it is rejected now.';

revoke all on function public.set_live_fold_rejection(date, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.set_live_fold_rejection(date, text, text, boolean)
  to service_role;
