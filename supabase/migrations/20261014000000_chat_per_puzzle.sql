-- One chat room per puzzle rather than one room for all time.
--
-- A message now belongs to the puzzle its sender had the chat open on, the same
-- way a notice already belongs to the puzzle its word was banked on. The panel
-- steps back and forward through puzzles like the game does, and each step reads
-- that puzzle's room alone.
--
-- Messages from before this have no puzzle, so they are filed under the
-- Mountain Time date they were posted on -- the calendar the daily drop turns
-- over on for most of the players who were here. A guess for a message sent
-- just either side of midnight, and the only one there is. The same date is the
-- column's default, for whatever still posts without naming a puzzle.
--
-- Additive, so it can be applied before the code that uses it ships: the old
-- chat_recent(bigint, integer) and chat_post(text, text, text) are left in place
-- for the deployment still calling them, and the new ones are overloads beside
-- them. A later migration can drop the old two.

alter table public.chat_messages add column if not exists puzzle_date date;

update public.chat_messages
  set puzzle_date = (created_at at time zone 'America/Denver')::date
  where puzzle_date is null;

alter table public.chat_messages
  alter column puzzle_date set default ((now() at time zone 'America/Denver')::date),
  alter column puzzle_date set not null;

create index if not exists chat_messages_puzzle
  on public.chat_messages (puzzle_date, id);
create index if not exists chat_notices_puzzle
  on public.chat_notices (puzzle_date, id);

-- One puzzle's room after message `p_after`, oldest first, at most `p_limit` of
-- them. Otherwise exactly the room chat_recent read before: `p_after = 0` is a
-- fresh open and gets the newest page, hidden rows are left out, and notices sit
-- among the messages in id order. Both modes share a puzzle's room.
create or replace function public.chat_recent(p_date date, p_after bigint default 0, p_limit integer default 50)
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
      where not c.hidden and c.puzzle_date = p_date and c.id > coalesce(p_after, 0)
      union all
      select n.id, n.handle, n.body, n.created_at, n.kind
      from public.chat_notices n
      where not n.hidden and n.puzzle_date = p_date and n.id > coalesce(p_after, 0)
    ) r
    order by r.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) m
  order by m.id asc;
$$;

-- chat_post, filing the message under `p_date`. The rate limit is unchanged and
-- still counts a player's messages across every puzzle: hopping rooms is not a
-- way to post faster.
create or replace function public.chat_post(p_player text, p_handle text, p_body text, p_date date)
returns table (status text, id bigint, handle text, body text, created_at timestamptz)
language plpgsql
as $$
declare
  last_at timestamptz;
  per_minute integer;
begin
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

revoke all on function public.chat_recent(date, bigint, integer) from public, anon, authenticated;
revoke all on function public.chat_post(text, text, text, date) from public, anon, authenticated;
grant execute on function public.chat_recent(date, bigint, integer) to service_role;
grant execute on function public.chat_post(text, text, text, date) to service_role;
