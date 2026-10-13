-- Notices in the chat room: a line the room posts itself when somebody banks a
-- word worth telling everybody about.
--
--   StormyFox47 banked top scoring word abaci (Mythic, 9.62)
--   StormyFox47 banked Legend word quokka (9.94)
--
-- The first when the word beats every word banked so far on that puzzle (in that
-- mode -- Standard and Freeform price words differently, so each keeps its own
-- record); the second for any other word scoring 9.5 or more. A word that is the
-- new record gets the first line only.
--
-- Its own table rather than a `kind` on chat_messages, so everything that reads
-- chat_messages -- the rate limit in chat_post, the room counts in chat_report --
-- goes on meaning "what players typed". The ids come from chat_messages' own
-- sequence, so the two tables share one id space and `chat_recent`'s cursor
-- still orders the whole room.
--
-- The scoring lives in the browser (src/game/dictionary.ts), not here, so the
-- client reports every word it banks on the live puzzle and this decides whether
-- it is a record. Like the leaderboard, a determined player can forge one; the
-- endpoint refuses what a real game could not produce, and `hidden = true`
-- removes a notice the same way it removes a message.

create table if not exists public.chat_notices (
  id bigint primary key default nextval('public.chat_messages_id_seq'::regclass),
  player_id text not null check (length(player_id) between 1 and 64),
  handle text not null check (length(handle) between 1 and 64),
  body text not null check (length(body) between 1 and 280),
  -- 'top' for a puzzle record, 'tier' for a 9.5+ word that is not one.
  kind text not null check (kind in ('top', 'tier')),
  puzzle_date date not null,
  mode text not null check (mode in ('standard', 'freeform')),
  word text not null check (word ~ '^[a-z]{2,30}$'),
  score numeric(5, 2) not null check (score between 0 and 10),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

-- One notice per word per player per puzzle, however often it is reported.
create unique index if not exists chat_notices_once
  on public.chat_notices (player_id, puzzle_date, mode, word);

comment on table public.chat_notices is
  'Notices the chat room posts itself (a puzzle record, a 9.5+ word). Written by chat_bank, read by chat_recent; set hidden = true to remove one.';

-- The best word banked so far on each puzzle, per mode: what a new word has to
-- beat to be announced as the top score.
create table if not exists public.chat_puzzle_tops (
  puzzle_date date not null,
  mode text not null check (mode in ('standard', 'freeform')),
  score numeric(5, 2) not null,
  word text not null,
  player_id text not null,
  updated_at timestamptz not null default now(),
  primary key (puzzle_date, mode)
);

comment on table public.chat_puzzle_tops is
  'The highest-scoring word banked so far on each puzzle and mode, for chat_bank.';

alter table public.chat_notices enable row level security;
alter table public.chat_puzzle_tops enable row level security;

revoke all on public.chat_notices from anon, authenticated;
revoke all on public.chat_puzzle_tops from anon, authenticated;
grant select, insert, update, delete on public.chat_notices to service_role;
grant select, insert, update, delete on public.chat_puzzle_tops to service_role;
grant usage on sequence public.chat_messages_id_seq to service_role;

-- Report one banked word, and post a notice if it earns one.
--
-- `p_top_body` and `p_tier_body` are the two lines api/chat.ts wrote for this
-- word; this picks one or neither. `p_tier_body` is null for a word under 9.5.
-- Answers `status`:
--   'top'       a new record for the puzzle; the notice is in the other columns
--   'tier'      a 9.5+ word that is not a record
--   'none'      nothing worth saying
--   'duplicate' this player's word was already reported
--
-- Serialised per puzzle, so two players banking at once cannot both be told they
-- hold the record. A tie is not a new record: the first to bank it keeps it.
create or replace function public.chat_bank(
  p_player text,
  p_handle text,
  p_date date,
  p_mode text,
  p_word text,
  p_score numeric,
  p_top_body text,
  p_tier_body text
)
returns table (status text, id bigint, handle text, body text, kind text, created_at timestamptz)
language plpgsql
as $$
declare
  best numeric;
  posted public.chat_notices%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('chat-top:' || p_date::text || ':' || p_mode));

  if exists (
    select 1 from public.chat_notices n
    where n.player_id = p_player and n.puzzle_date = p_date and n.mode = p_mode and n.word = p_word
  ) then
    return query select 'duplicate'::text, null::bigint, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select t.score into best
  from public.chat_puzzle_tops t
  where t.puzzle_date = p_date and t.mode = p_mode;

  if best is null or p_score > best then
    insert into public.chat_puzzle_tops as t (puzzle_date, mode, score, word, player_id)
    values (p_date, p_mode, p_score, p_word, p_player)
    on conflict (puzzle_date, mode) do update
      set score = excluded.score, word = excluded.word, player_id = excluded.player_id,
          updated_at = now();

    insert into public.chat_notices (player_id, handle, body, kind, puzzle_date, mode, word, score)
    values (p_player, p_handle, p_top_body, 'top', p_date, p_mode, p_word, p_score)
    returning * into posted;
  elsif p_tier_body is not null then
    insert into public.chat_notices (player_id, handle, body, kind, puzzle_date, mode, word, score)
    values (p_player, p_handle, p_tier_body, 'tier', p_date, p_mode, p_word, p_score)
    returning * into posted;
  else
    return query select 'none'::text, null::bigint, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  return query select posted.kind, posted.id, posted.handle, posted.body, posted.kind, posted.created_at;
end;
$$;

-- The room, now with notices in it: the same page as before, with `kind` saying
-- which rows are messages. Dropped first because the columns it returns change.
drop function if exists public.chat_recent(bigint, integer);

create function public.chat_recent(p_after bigint default 0, p_limit integer default 50)
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
      where not n.hidden and n.id > coalesce(p_after, 0)
    ) r
    order by r.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) m
  order by m.id asc;
$$;

revoke all on function public.chat_recent(bigint, integer) from public, anon, authenticated;
revoke all on function public.chat_bank(text, text, date, text, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.chat_recent(bigint, integer) to service_role;
grant execute on function public.chat_bank(text, text, date, text, text, numeric, text, text)
  to service_role;
