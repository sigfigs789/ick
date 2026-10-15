-- Announce a 9.5+ word once per puzzle, whichever mode it is found in.
--
-- chat_find (20261014050000) announced a word once per puzzle *and mode*, so
-- the same word could be posted twice: once found in Standard and again in
-- Freeform. That makes the room repetitive, so the first find in either mode is
-- now the only one. Anybody who banks the word after that, in either mode, gets
-- the private 'earlier' line, pointed at the first finder and the mode they
-- found it in:
--
--   StormyFox47 discovered quokka earlier in standard mode
--
-- The private line's body arrives ending in the banker's own mode (see
-- earlierNoticeBody), so its suffix is swapped for the first finder's mode. Its
-- row takes that mode too, which is what the bubble paints the line by. A
-- player who banks the word again, in either mode, is a 'duplicate'.
--
-- Same signature and answer as before, so api/chat.ts is unchanged. Replaced in
-- place, so it is safe to re-run.

-- The first notice for a word on a puzzle, in any mode.
create index if not exists chat_notices_date_word
  on public.chat_notices (puzzle_date, word, id);

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
  finder_mode text;
  suffix text := ' in ' || p_mode || ' mode';
  earlier text := p_earlier_body;
  posted public.chat_notices%rowtype;
begin
  -- Serialised per word, not per word and mode, so two players banking it at
  -- once in different modes cannot both be first.
  perform pg_advisory_xact_lock(hashtext('chat-find:' || p_date::text || ':' || p_word));

  if exists (
    select 1 from public.chat_notices n
    where n.player_id = p_player and n.puzzle_date = p_date and n.word = p_word
  ) then
    return query select 'duplicate'::text, null::bigint, null::text, null::text, null::text,
      null::timestamptz, null::text, null::text, null::text;
    return;
  end if;

  select n.handle, n.mode into finder, finder_mode
  from public.chat_notices n
  where n.puzzle_date = p_date and n.word = p_word
    and n.kind <> 'earlier' and not n.hidden
  order by n.id
  limit 1;

  if finder is null then
    insert into public.chat_notices (player_id, handle, body, kind, puzzle_date, mode, word, score, tier)
    values (p_player, p_handle, p_find_body, 'find', p_date, p_mode, p_word, p_score, p_tier)
    returning * into posted;
  else
    if right(earlier, length(suffix)) = suffix then
      earlier := left(earlier, length(earlier) - length(suffix)) || ' in ' || finder_mode || ' mode';
    end if;
    insert into public.chat_notices (player_id, handle, body, kind, puzzle_date, mode, word, score, tier)
    values (
      p_player, p_handle, replace(earlier, '{finder}', finder), 'earlier',
      p_date, finder_mode, p_word, p_score, p_tier
    )
    returning * into posted;
  end if;

  return query select posted.kind, posted.id, posted.handle, posted.body, posted.kind,
    posted.created_at, posted.word, posted.mode, posted.tier;
end;
$$;

-- Granted again explicitly: service_role does not inherit it.
revoke all on function public.chat_find(text, text, date, text, text, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.chat_find(text, text, date, text, text, text, numeric, text, text)
  to service_role;
