-- A "top scoring word" notice only for the day's best word among everybody.
--
-- chat_bank used to hold a record per puzzle *per mode*, built only from the
-- words the web game reported to the room. So a Freeform word could be called
-- the top scoring word while a better Standard word sat in the same room, and a
-- word could beat the room's record without beating a better one that never
-- reached it -- banked before notices shipped, or whose report did not land.
--
-- Now a word is the top scoring word only when it beats every word banked on
-- that puzzle so far, by anybody, in either mode: the room's own records for
-- both modes, and every other player's best word for the day on the
-- leaderboard. A word that is not gets no top notice; at 9.5 or more it still
-- gets the tier line, and otherwise nothing.
--
-- The player's own leaderboard rows are left out: the game submits the day's
-- score before it reports the word, so their row may already hold this very
-- word and a word does not have to beat itself. Their earlier words are in the
-- room's records if they were reported.

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
  -- Per puzzle rather than per mode now that one record spans both.
  perform pg_advisory_xact_lock(hashtext('chat-top:' || p_date::text));

  if exists (
    select 1 from public.chat_notices n
    where n.player_id = p_player and n.puzzle_date = p_date and n.mode = p_mode and n.word = p_word
  ) then
    return query select 'duplicate'::text, null::bigint, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- The leaderboard keeps hundredths, and the game shows a score under 9.5 to
  -- one decimal: rounded the same way, so a word is compared with what the
  -- other player was shown for theirs and an equal score stays a tie.
  select greatest(
    (select max(t.score) from public.chat_puzzle_tops t where t.puzzle_date = p_date),
    (select max(case when s.top_score >= 9.5 then s.top_score else round(s.top_score, 1) end)
      from public.leaderboard_scores s
      where s.puzzle_date = p_date and s.player_id::text <> p_player)
  ) into best;

  -- This mode's record moves whether or not the word is the day's best, so the
  -- row stays what its comment says it is.
  insert into public.chat_puzzle_tops as t (puzzle_date, mode, score, word, player_id)
  values (p_date, p_mode, p_score, p_word, p_player)
  on conflict (puzzle_date, mode) do update
    set score = excluded.score, word = excluded.word, player_id = excluded.player_id,
        updated_at = now()
    where excluded.score > t.score;

  if best is null or p_score > best then
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

revoke all on function public.chat_bank(text, text, date, text, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.chat_bank(text, text, date, text, text, numeric, text, text)
  to service_role;
