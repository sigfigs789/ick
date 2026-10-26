-- One player's own suggestions, and whether each one got in.
--
-- The game thanks a player when a word they suggested is accepted into the
-- dictionary, and gives them an achievement for it (see src/game/suggestions.ts).
-- That needs the answer to "which words did *this* browser suggest, and what
-- became of them" -- including the words suggested before the game kept any
-- record of its own, which live only here, as `word_suggested` events carrying
-- the board identity in `props.player_id`.
--
-- The verdict is `word_sightings.status`, the same mark the /suggested-words
-- page draws: 'accepted' is a word that got in. A suggestion nobody has triaged
-- has no sighting row and reads as 'new'.
--
-- Nothing here is more than the queue already shows to anybody: the words are
-- on /suggested-words, and the player id is a UUID the browser invented. What
-- this adds is the filter, so a player's own list does not have to be found in
-- everybody's.

-- The lookup is by player within one event name, so the index is too. Partial,
-- because suggestions are a sliver of the table.
create index if not exists analytics_events_word_suggested_player_idx
  on public.analytics_events ((props ->> 'player_id'))
  where name = 'word_suggested';

create or replace function public.list_player_suggestions(p_player text)
returns table (
  word text,
  suggested_at timestamptz,
  status text
)
language sql
stable
as $$
  select
    lower(e.props ->> 'word') as word,
    min(e.created_at) as suggested_at,
    -- One sighting row per word at most, so this is that row's status.
    coalesce(max(s.status), 'new') as status
  from public.analytics_events e
  left join public.word_sightings s on s.word = lower(e.props ->> 'word')
  where e.name = 'word_suggested'
    and e.props ->> 'player_id' = p_player
    -- The game's own input rule, as everywhere the suggestion box is read.
    and lower(e.props ->> 'word') ~ '^[a-z]{2,30}$'
  group by 1
  order by min(e.created_at) desc
  limit 200;
$$;

comment on function public.list_player_suggestions(text) is
  'One player''s suggested words with their triage status, newest first. Read by api/review.ts for the accepted-suggestion notice.';

revoke all on function public.list_player_suggestions(text) from public, anon, authenticated;
grant execute on function public.list_player_suggestions(text) to service_role;
