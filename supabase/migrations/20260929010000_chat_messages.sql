-- The chat room: one shared room of short messages, read by the chat bubble on
-- every page (src/components/ChatBubble.tsx) through api/chat.ts.
--
-- One room, no threads, no edits. A message is a handle, a body and a time.
-- The handle is stored rather than derived on read because the reader never
-- sees a player id: api/chat.ts computes it from the id on the way in (the same
-- src/game/handle.ts the board uses), and the id stays here for moderation and
-- rate limiting only. Publishing ids would let anybody post as anybody.
--
-- Moderation is a flag rather than a delete, so a removed message is still here
-- to look at if somebody asks why: set `hidden = true` on the row and it is gone
-- from the room on every client's next poll.

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  player_id text not null check (length(player_id) between 1 and 64),
  handle text not null check (length(handle) between 1 and 64),
  -- The same cap api/chat.ts enforces, so a direct insert cannot exceed it.
  body text not null check (length(body) between 1 and 280),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_player_recent
  on public.chat_messages (player_id, created_at desc);

comment on table public.chat_messages is
  'The chat room. Written and read only by api/chat.ts; set hidden = true to remove a message.';

alter table public.chat_messages enable row level security;

-- RLS with no policies denies anon and authenticated outright; the service role
-- is granted explicitly rather than trusted to inherit (see fold_reviews).
revoke all on public.chat_messages from anon, authenticated;
grant select, insert, update, delete on public.chat_messages to service_role;

-- The room after message `p_after`, oldest first, at most `p_limit` of them.
--
-- `p_after = 0` is a fresh open: the newest `p_limit`, still returned oldest
-- first so the client can append in order. Hidden rows are left out, which is
-- the whole of how moderation reaches a client -- but a client that already
-- shows a message keeps showing it until it reopens the room. `p_after` is an id
-- rather than a time so two messages in the same millisecond cannot be skipped.
create or replace function public.chat_recent(p_after bigint default 0, p_limit integer default 50)
returns table (id bigint, handle text, body text, created_at timestamptz)
language sql
stable
as $$
  select m.id, m.handle, m.body, m.created_at
  from (
    select c.id, c.handle, c.body, c.created_at
    from public.chat_messages c
    where not c.hidden and c.id > coalesce(p_after, 0)
    order by c.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) m
  order by m.id asc;
$$;

-- Post one message, unless the player is posting too fast.
--
-- The rate limit lives here rather than in the edge function because the edge
-- function has no memory between requests: counting the player's recent rows in
-- the same statement that inserts is the only place the check and the write
-- cannot race. Two limits: one message per CHAT_MIN_GAP (3 seconds), and no more
-- than 10 in any minute. Answers the stored row, or `status = 'rate-limited'`
-- with nothing written.
create or replace function public.chat_post(p_player text, p_handle text, p_body text)
returns table (status text, id bigint, handle text, body text, created_at timestamptz)
language plpgsql
as $$
declare
  last_at timestamptz;
  per_minute integer;
begin
  -- Serialise one player's posts so two requests at once cannot both pass.
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
    insert into public.chat_messages as c (player_id, handle, body)
    values (p_player, p_handle, p_body)
    returning 'ok'::text, c.id, c.handle, c.body, c.created_at;
end;
$$;

revoke all on function public.chat_recent(bigint, integer) from public, anon, authenticated;
revoke all on function public.chat_post(text, text, text) from public, anon, authenticated;
grant execute on function public.chat_recent(bigint, integer) to service_role;
grant execute on function public.chat_post(text, text, text) to service_role;
