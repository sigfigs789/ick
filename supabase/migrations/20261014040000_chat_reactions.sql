-- Emoji reactions on the chat room's lines (src/components/ChatBubble.tsx),
-- through api/chat.ts.
--
-- A reaction is one player putting one emoji on one line. A line is a player's
-- message or a notice the room posted itself -- the two share one id space (see
-- the 20261013000000 migration), so `message_id` names either without saying
-- which, and there is no foreign key to one table.
--
-- Like a message, a reaction carries the handle rather than the player id on
-- the way out: the room shows who reacted, and the id stays here for the rate
-- limit and moderation. `puzzle_date` is the room the line is in, so one query
-- reads a room's reactions without joining both tables.
--
-- Additive: nothing that reads chat_messages or chat_notices changes.

create table if not exists public.chat_reactions (
  message_id bigint not null,
  player_id text not null check (length(player_id) between 1 and 64),
  handle text not null check (length(handle) between 1 and 64),
  -- One emoji, which api/chat.ts checks; a family or flag runs to a few code
  -- points, so the cap is generous.
  emoji text not null check (length(emoji) between 1 and 16),
  puzzle_date date not null,
  created_at timestamptz not null default now(),
  primary key (message_id, player_id, emoji)
);

create index if not exists chat_reactions_puzzle
  on public.chat_reactions (puzzle_date, message_id);
create index if not exists chat_reactions_player_recent
  on public.chat_reactions (player_id, created_at desc);

comment on table public.chat_reactions is
  'Emoji reactions on chat lines. Written by chat_react, read by chat_room_reactions; delete a row to remove one.';

alter table public.chat_reactions enable row level security;

revoke all on public.chat_reactions from anon, authenticated;
grant select, insert, update, delete on public.chat_reactions to service_role;

-- Every reaction in puzzle `p_date`'s room: one row per line and emoji, with
-- the handles that put it there in the order they did. Lines appear in id
-- order and each line's emoji in the order they were first used, so chips do
-- not shuffle as counts change. Reactions on a hidden line are read too; the
-- client has no line to put them on and drops them.
create or replace function public.chat_room_reactions(p_date date)
returns table (message_id bigint, emoji text, handles text[])
language sql
stable
as $$
  select r.message_id, r.emoji, array_agg(r.handle order by r.created_at, r.handle)
  from public.chat_reactions r
  where r.puzzle_date = p_date
  group by r.message_id, r.emoji
  order by r.message_id, min(r.created_at), r.emoji
  limit 2000;
$$;

-- Add (`p_on`) or take back one player's emoji on one line in puzzle `p_date`'s
-- room. Answers `status`:
--   'ok'           done (adding twice, or taking back what was never there, is
--                  not an error); the line's reactions follow, one row each
--   'missing'      no such line in that room, or it is hidden
--   'full'         the line already carries every distinct emoji it may, or
--                  this player has put on all they may
--   'rate-limited' this player is adding reactions too fast
--
-- Taking a reaction back is never limited, so a player can always undo.
create or replace function public.chat_react(
  p_player text,
  p_handle text,
  p_date date,
  p_message bigint,
  p_emoji text,
  p_on boolean
)
returns table (status text, emoji text, handles text[])
language plpgsql
as $$
declare
  added integer;
begin
  perform pg_advisory_xact_lock(hashtext('chat-react:' || p_player));

  if not exists (
    select 1 from public.chat_messages c
    where c.id = p_message and c.puzzle_date = p_date and not c.hidden
    union all
    select 1 from public.chat_notices n
    where n.id = p_message and n.puzzle_date = p_date and not n.hidden
  ) then
    return query select 'missing'::text, null::text, null::text[];
    return;
  end if;

  if p_on then
    if not exists (
      select 1 from public.chat_reactions r
      where r.message_id = p_message and r.player_id = p_player and r.emoji = p_emoji
    ) then
      select count(*) into added
      from public.chat_reactions r
      where r.player_id = p_player and r.created_at > now() - interval '1 minute';
      if added >= 30 then
        return query select 'rate-limited'::text, null::text, null::text[];
        return;
      end if;

      if (
        select count(*) from public.chat_reactions r
        where r.message_id = p_message and r.player_id = p_player
      ) >= 6 or (
        not exists (
          select 1 from public.chat_reactions r
          where r.message_id = p_message and r.emoji = p_emoji
        )
        and (
          select count(distinct r.emoji) from public.chat_reactions r
          where r.message_id = p_message
        ) >= 12
      ) then
        return query select 'full'::text, null::text, null::text[];
        return;
      end if;

      insert into public.chat_reactions (message_id, player_id, handle, emoji, puzzle_date)
      values (p_message, p_player, p_handle, p_emoji, p_date)
      on conflict do nothing;
    end if;
  else
    delete from public.chat_reactions r
    where r.message_id = p_message and r.player_id = p_player and r.emoji = p_emoji;
  end if;

  return query
    select 'ok'::text, r.emoji, array_agg(r.handle order by r.created_at, r.handle)
    from public.chat_reactions r
    where r.message_id = p_message
    group by r.emoji
    order by min(r.created_at), r.emoji;
  -- A line left with no reactions still answers that it worked.
  if not found then
    return query select 'ok'::text, null::text, null::text[];
  end if;
end;
$$;

revoke all on function public.chat_room_reactions(date) from public, anon, authenticated;
revoke all on function public.chat_react(text, text, date, bigint, text, boolean)
  from public, anon, authenticated;
grant execute on function public.chat_room_reactions(date) to service_role;
grant execute on function public.chat_react(text, text, date, bigint, text, boolean)
  to service_role;
