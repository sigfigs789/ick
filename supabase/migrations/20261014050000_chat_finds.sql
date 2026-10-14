-- Notices in the chat room, announced once per word.
--
--   StormyFox47 banked Legend word quokka (9.94) in standard mode
--
-- The room no longer announces a puzzle's new top score: only a word scoring
-- 9.5 or more (Mythic or Legend), and only the first time anybody banks it on
-- that puzzle in that mode. A player who banks it after that gets a line only
-- they are told about, naming who got there first:
--
--   StormyFox47 discovered quokka earlier in standard mode
--
-- That line is a row here too (kind 'earlier'), so it takes an id from the
-- room's sequence and sits in the right place among the room's messages, and
-- the unique index on chat_notices still stops a player being told twice.
-- chat_recent leaves it out: the room never shows it to anybody. api/chat.ts
-- hands it back to the one player who banked the word, and their browser keeps
-- it (see src/game/chatNotices.ts).
--
-- Additive like the rooms split (20261014000000): chat_bank and chat_puzzle_tops
-- are left for the deployment still calling them, and a later migration can drop
-- them. Notices already posted keep their kinds and are still shown.

alter table public.chat_notices drop constraint if exists chat_notices_kind_check;
alter table public.chat_notices
  add constraint chat_notices_kind_check check (kind in ('top', 'tier', 'find', 'earlier'));

-- The tier a 'find' or 'earlier' notice is for, which the bubble colors it by.
alter table public.chat_notices add column if not exists tier text
  check (tier is null or tier in ('Mythic', 'Legend'));

-- The first notice for a word on a puzzle, which a later finder is pointed at.
create index if not exists chat_notices_word
  on public.chat_notices (puzzle_date, mode, word, id);

comment on table public.chat_notices is
  'Notices the chat room posts itself (a 9.5+ word, the first time it is banked on a puzzle). Kind ''earlier'' rows are private to their player and never shown in the room. Written by chat_find, read by chat_recent; set hidden = true to remove one.';

-- Report one banked 9.5+ word.
--
-- `p_find_body` is the room's line for the first finder; `p_earlier_body` the
-- private one for anybody after, with `{finder}` where the first finder's handle
-- goes. Answers `status`:
--   'find'      the first to bank it; the room's notice is in the other columns
--   'earlier'   somebody already did; the private line is in the other columns
--   'duplicate' this player's word was already reported
--
-- Serialised per word, so two players banking it at once cannot both be the
-- first. A notice that was hidden does not count as the word being found.
create or replace function public.chat_find(
  p_player text,
  p_handle text,
  p_date date,
  p_mode text,
  p_word text,
  p_tier text,
  p_score numeric,
  p_find_body text,
  p_earlier_body text
)
returns table (
  status text, id bigint, handle text, body text, kind text, created_at timestamptz,
  word text, mode text, tier text
)
language plpgsql
as $$
declare
  finder text;
  posted public.chat_notices%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('chat-find:' || p_date::text || ':' || p_mode || ':' || p_word));

  if exists (
    select 1 from public.chat_notices n
    where n.player_id = p_player and n.puzzle_date = p_date and n.mode = p_mode and n.word = p_word
  ) then
    return query select 'duplicate'::text, null::bigint, null::text, null::text, null::text,
      null::timestamptz, null::text, null::text, null::text;
    return;
  end if;

  select n.handle into finder
  from public.chat_notices n
  where n.puzzle_date = p_date and n.mode = p_mode and n.word = p_word
    and n.kind <> 'earlier' and not n.hidden
  order by n.id
  limit 1;

  if finder is null then
    insert into public.chat_notices (player_id, handle, body, kind, puzzle_date, mode, word, score, tier)
    values (p_player, p_handle, p_find_body, 'find', p_date, p_mode, p_word, p_score, p_tier)
    returning * into posted;
  else
    insert into public.chat_notices (player_id, handle, body, kind, puzzle_date, mode, word, score, tier)
    values (
      p_player, p_handle, replace(p_earlier_body, '{finder}', finder), 'earlier',
      p_date, p_mode, p_word, p_score, p_tier
    )
    returning * into posted;
  end if;

  return query select posted.kind, posted.id, posted.handle, posted.body, posted.kind,
    posted.created_at, posted.word, posted.mode, posted.tier;
end;
$$;

-- The room as before, with what a notice is about (its word, mode and tier, null
-- for a player's message) and without anybody's private 'earlier' lines.
-- Dropped first because the columns it returns change.
drop function if exists public.chat_recent(date, bigint, integer);

create function public.chat_recent(p_date date, p_after bigint default 0, p_limit integer default 50)
returns table (
  id bigint, handle text, body text, created_at timestamptz, kind text,
  word text, mode text, tier text
)
language sql
stable
as $$
  select m.id, m.handle, m.body, m.created_at, m.kind, m.word, m.mode, m.tier
  from (
    select r.*
    from (
      select c.id, c.handle, c.body, c.created_at, 'message'::text as kind,
        null::text as word, null::text as mode, null::text as tier
      from public.chat_messages c
      where not c.hidden and c.puzzle_date = p_date and c.id > coalesce(p_after, 0)
      union all
      select n.id, n.handle, n.body, n.created_at, n.kind, n.word, n.mode, n.tier
      from public.chat_notices n
      where not n.hidden and n.kind <> 'earlier'
        and n.puzzle_date = p_date and n.id > coalesce(p_after, 0)
    ) r
    order by r.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) m
  order by m.id asc;
$$;

-- The pre-split reader, kept for an old deployment, must not leak the private
-- lines either. Same columns as before, so it is replaced in place.
create or replace function public.chat_recent(p_after bigint default 0, p_limit integer default 50)
returns table (id bigint, handle text, body text, created_at timestamptz, kind text)
language sql
stable
as $$
  select m.id, m.handle, m.body, m.created_at, m.kind
  from (
    select r.id, r.handle, r.body, r.created_at, r.kind
    from (
      select c.id, c.handle, c.body, c.created_at, 'message'::text as kind
      from public.chat_messages c
      where not c.hidden and c.id > coalesce(p_after, 0)
      union all
      select n.id, n.handle, n.body, n.created_at, n.kind
      from public.chat_notices n
      where not n.hidden and n.kind <> 'earlier' and n.id > coalesce(p_after, 0)
    ) r
    order by r.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) m
  order by m.id asc;
$$;

revoke all on function public.chat_recent(date, bigint, integer) from public, anon, authenticated;
revoke all on function public.chat_find(text, text, date, text, text, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.chat_recent(date, bigint, integer) to service_role;
grant execute on function public.chat_find(text, text, date, text, text, text, numeric, text, text)
  to service_role;
