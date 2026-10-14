-- Room notices, retuned.
--
--   StormyFox47 banked top scoring word quokka (Rare, 7.40)
--   CalmOtter3 usurped the top score with abaci (Mythic, 9.62)
--   StormyFox47 banked Legend word kakapo (9.94)
--
-- A top score now has to be worth announcing: a word under 7.0 is never the
-- room's record, however early it was banked. And it is a record against the
-- other players only -- a word that matches another player's top score takes it
-- from them (the room says it was usurped), while matching your own is nothing
-- new. Beating your own top still says so, as a plain top score.
--
-- Only words at 7.0 or more are recorded in chat_puzzle_tops, so "usurped" always
-- means a top somebody else held. A record a puzzle already has from the old
-- rules stays and has to be beaten or matched like any other.
--
-- A notice also keeps the tier the game showed for its word, so the bubble can
-- colour a 9.5+ line as the Mythic or Legend it is.
--
-- Additive like the 20261014000000 migration: the old chat_bank stays for the
-- deployment still calling it, and the new one is an overload beside it.

alter table public.chat_notices add column if not exists tier text;

-- Report one banked word, and post a notice if it earns one.
--
-- `p_top_body` and `p_usurp_body` are the lines for a new top score, plain and
-- taken from another player; both null for a word under 7.0. `p_tier_body` is
-- null for a word under 9.5. Answers `status` as before:
--   'top'       a new record for the puzzle; the notice is in the other columns
--   'tier'      a 9.5+ word that is not a record
--   'none'      nothing worth saying
--   'duplicate' this player's word was already reported
--
-- Serialised per puzzle, so two players banking at once cannot both be told they
-- hold the record.
create or replace function public.chat_bank(
  p_player text,
  p_handle text,
  p_date date,
  p_mode text,
  p_word text,
  p_score numeric,
  p_tier text,
  p_top_body text,
  p_usurp_body text,
  p_tier_body text
)
returns table (status text, id bigint, handle text, body text, kind text, created_at timestamptz, tier text)
language plpgsql
as $$
declare
  best numeric;
  holder text;
  posted public.chat_notices%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('chat-top:' || p_date::text || ':' || p_mode));

  if exists (
    select 1 from public.chat_notices n
    where n.player_id = p_player and n.puzzle_date = p_date and n.mode = p_mode and n.word = p_word
  ) then
    return query select 'duplicate'::text, null::bigint, null::text, null::text, null::text,
      null::timestamptz, null::text;
    return;
  end if;

  select t.score, t.player_id into best, holder
  from public.chat_puzzle_tops t
  where t.puzzle_date = p_date and t.mode = p_mode;

  if p_top_body is not null and (
    best is null
    or p_score > best
    or (p_score = best and holder <> p_player)
  ) then
    insert into public.chat_puzzle_tops as t (puzzle_date, mode, score, word, player_id)
    values (p_date, p_mode, p_score, p_word, p_player)
    on conflict (puzzle_date, mode) do update
      set score = excluded.score, word = excluded.word, player_id = excluded.player_id,
          updated_at = now();

    insert into public.chat_notices (player_id, handle, body, kind, puzzle_date, mode, word, score, tier)
    values (
      p_player, p_handle,
      case when holder is not null and holder <> p_player then coalesce(p_usurp_body, p_top_body)
           else p_top_body end,
      'top', p_date, p_mode, p_word, p_score, p_tier
    )
    returning * into posted;
  elsif p_tier_body is not null then
    insert into public.chat_notices (player_id, handle, body, kind, puzzle_date, mode, word, score, tier)
    values (p_player, p_handle, p_tier_body, 'tier', p_date, p_mode, p_word, p_score, p_tier)
    returning * into posted;
  else
    return query select 'none'::text, null::bigint, null::text, null::text, null::text,
      null::timestamptz, null::text;
    return;
  end if;

  return query select posted.kind, posted.id, posted.handle, posted.body, posted.kind,
    posted.created_at, posted.tier;
end;
$$;

-- One puzzle's room, as the 20261014000000 migration reads it, now with each
-- notice's tier (null for a message, and for a notice posted before this).
-- Dropped first because the columns it returns change.
drop function if exists public.chat_recent(date, bigint, integer);

create function public.chat_recent(p_date date, p_after bigint default 0, p_limit integer default 50)
returns table (id bigint, handle text, body text, created_at timestamptz, kind text, tier text)
language sql
stable
as $$
  select m.id, m.handle, m.body, m.created_at, m.kind, m.tier
  from (
    select r.id, r.handle, r.body, r.created_at, r.kind, r.tier
    from (
      select c.id, c.handle, c.body, c.created_at, 'message'::text as kind, null::text as tier
      from public.chat_messages c
      where not c.hidden and c.puzzle_date = p_date and c.id > coalesce(p_after, 0)
      union all
      select n.id, n.handle, n.body, n.created_at, n.kind, n.tier
      from public.chat_notices n
      where not n.hidden and n.puzzle_date = p_date and n.id > coalesce(p_after, 0)
    ) r
    order by r.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) m
  order by m.id asc;
$$;

revoke all on function public.chat_recent(date, bigint, integer) from public, anon, authenticated;
revoke all on function public.chat_bank(text, text, date, text, text, numeric, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.chat_recent(date, bigint, integer) to service_role;
grant execute on function public.chat_bank(text, text, date, text, text, numeric, text, text, text, text)
  to service_role;
