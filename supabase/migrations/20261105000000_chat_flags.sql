-- Reports on chat messages: the "Report" a player can press on somebody else's
-- line (src/game/chatModeration.ts), through api/chat.ts.
--
-- The App Store asks an app that shows what players write for a way to report
-- it and for the developer to act on reports (Review Guideline 1.2). A report is
-- one player flagging one message. Only a player's message can be flagged --
-- the room's notices are built from dictionary words by the server -- and never
-- the reporter's own.
--
-- Acting on it is two steps:
--
--   1. Automatically, the third player to flag a message hides it, with the
--      same `hidden = true` a hand removal sets (see 20260929010000), so it is
--      gone from every client's next poll without waiting for anybody. There
--      are no accounts, so three ids is not proof of three people; a message
--      hidden wrongly is put back by setting `hidden = false`.
--   2. By hand, from the `chat_flagged` view below: every flagged message,
--      most-flagged first, with whether it is already hidden. A message is
--      removed with `hidden`, and whoever wrote it with a row in `chat_bans`,
--      which stops every message they post from then on and hides the ones
--      they already did:
--
--        select * from public.chat_flagged limit 50;
--        update public.chat_messages set hidden = true where id = <id>;
--        insert into public.chat_bans (player_id) values ('<player_id>');
--
-- Named "flag" rather than "report" because chat_report is already the
-- /analytics page's function (20260930010000).

create table if not exists public.chat_flags (
  message_id bigint not null references public.chat_messages (id) on delete cascade,
  player_id text not null check (length(player_id) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (message_id, player_id)
);

create index if not exists chat_flags_player_recent
  on public.chat_flags (player_id, created_at desc);

comment on table public.chat_flags is
  'Players'' reports on chat messages. Written by chat_flag; review through the chat_flagged view.';

alter table public.chat_flags enable row level security;

revoke all on public.chat_flags from anon, authenticated;
grant select, insert, update, delete on public.chat_flags to service_role;

-- Flag message `p_message` in puzzle `p_date`'s room for player `p_player`.
--
-- Answers one row, `status`:
--   'ok'            recorded (or recorded already: flagging twice is a no-op)
--   'missing'       no such player's message in that room, it is hidden, or it
--                   is the reporter's own
--   'rate-limited'  more than 30 flags from this player in the last hour
create or replace function public.chat_flag(p_player text, p_date date, p_message bigint)
returns table (status text)
language plpgsql
as $$
declare
  author text;
  recent integer;
  flags integer;
begin
  perform pg_advisory_xact_lock(hashtext('chat-flag:' || p_player));

  select c.player_id into author
  from public.chat_messages c
  where c.id = p_message and c.puzzle_date = p_date and not c.hidden;

  if author is null or author = p_player then
    return query select 'missing'::text;
    return;
  end if;

  select count(*) into recent
  from public.chat_flags f
  where f.player_id = p_player and f.created_at > now() - interval '1 hour';

  if recent >= 30 then
    return query select 'rate-limited'::text;
    return;
  end if;

  insert into public.chat_flags (message_id, player_id)
  values (p_message, p_player)
  on conflict do nothing;

  select count(*) into flags from public.chat_flags f where f.message_id = p_message;
  if flags >= 3 then
    update public.chat_messages set hidden = true where id = p_message;
  end if;

  return query select 'ok'::text;
end;
$$;

revoke all on function public.chat_flag(text, date, bigint) from public, anon, authenticated;
grant execute on function public.chat_flag(text, date, bigint) to service_role;

-- Every flagged message, most-flagged and then newest first, for review by hand.
create or replace view public.chat_flagged
with (security_invoker = true) as
  select
    c.id,
    c.puzzle_date,
    c.handle,
    c.player_id,
    c.body,
    c.hidden,
    count(f.player_id) as flags,
    max(f.created_at) as last_flagged_at
  from public.chat_messages c
  join public.chat_flags f on f.message_id = c.id
  group by c.id
  order by flags desc, last_flagged_at desc;

revoke all on public.chat_flagged from anon, authenticated;
grant select on public.chat_flagged to service_role;

-- Players removed from the chat. A ban hides everything they wrote and refuses
-- anything new; it leaves their scores and the board alone. There are no
-- accounts, so a player who reinstalls is a new id -- the ban is for the
-- persistent nuisance, and the flags above for the rest.
create table if not exists public.chat_bans (
  player_id text primary key check (length(player_id) between 1 and 64),
  created_at timestamptz not null default now()
);

comment on table public.chat_bans is
  'Players removed from the chat. Insert a player_id to ban; chat_post refuses them and their messages are hidden.';

alter table public.chat_bans enable row level security;

revoke all on public.chat_bans from anon, authenticated;
grant select, insert, update, delete on public.chat_bans to service_role;

-- A ban takes the banned player's messages out of the room as it lands.
create or replace function public.chat_bans_hide()
returns trigger
language plpgsql
as $$
begin
  update public.chat_messages set hidden = true where player_id = new.player_id and not hidden;
  return new;
end;
$$;

drop trigger if exists chat_bans_hide on public.chat_bans;
create trigger chat_bans_hide after insert on public.chat_bans
  for each row execute function public.chat_bans_hide();

revoke all on function public.chat_bans_hide() from public, anon, authenticated;

-- chat_post as 20261014000000 left it, refusing a banned player with
-- `status = 'banned'` before anything else.
create or replace function public.chat_post(p_player text, p_handle text, p_body text, p_date date)
returns table (status text, id bigint, handle text, body text, created_at timestamptz)
language plpgsql
as $$
declare
  last_at timestamptz;
  per_minute integer;
begin
  if exists (select 1 from public.chat_bans b where b.player_id = p_player) then
    return query select 'banned'::text, null::bigint, null::text, null::text, null::timestamptz;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('chat:' || p_player));

  select max(c.created_at), count(*) filter (where c.created_at > now() - interval '1 minute')
    into last_at, per_minute
  from public.chat_messages c
  where c.player_id = p_player and c.created_at > now() - interval '1 minute';

  if (last_at is not null and last_at > now() - interval '3 seconds') or per_minute >= 10 then
    return query select 'rate-limited'::text, null::bigint, null::text, null::text, null::timestamptz;
    return;
  end if;

  return query
    insert into public.chat_messages as c (player_id, handle, body, puzzle_date)
    values (p_player, p_handle, p_body, p_date)
    returning 'ok'::text, c.id, c.handle, c.body, c.created_at;
end;
$$;

revoke all on function public.chat_post(text, text, text, date) from public, anon, authenticated;
grant execute on function public.chat_post(text, text, text, date) to service_role;
