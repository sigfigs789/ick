-- The word queue says who suggested each word, and what it would score.
--
-- /suggested-words reads "suggested by StormyFox47", or "... and 2 others" when
-- more than one player asked. This adds `suggesters`: the distinct board
-- identities (`props.player_id` on the `word_suggested` events) that suggested
-- the word, earliest first. api/review.ts turns each into the handle the board
-- already shows for it (src/game/handle.ts) and sends only the first handle and
-- the count -- the ids themselves never leave the server.
--
-- And `zipf_estimate`: the daily suggestion review
-- (.github/workflows/review-suggested-words.yml) asks Claude for a Zipf for
-- each word no corpus measures, and keeps it here, apart from `zipf` -- which is
-- a measurement, and which the same review fills for a player-only row when the
-- game's corpus has one. The page shows the estimate marked "est." where it
-- used to show "TBD".
alter table public.word_sightings
  add column if not exists zipf_estimate numeric;

comment on column public.word_sightings.zipf_estimate is
  'Claude''s estimated Zipf for a word no corpus measures, from the daily suggestion review. A guess, never a measurement.';

-- Built on 20260911050000's definition, which is the live one; nothing else
-- moves. Dropped and recreated because a function's output columns cannot be
-- changed in place.
drop function if exists public.list_suggested_words(integer);

create or replace function public.list_suggested_words(p_limit integer default 200)
returns table (
  word text,
  origin text,
  zipf numeric,
  pos text[],
  first_use text,
  mw_source text,
  lookups integer,
  suggestions integer,
  first_at timestamptz,
  last_at timestamptz,
  status text,
  outcome text,
  suggesters text[],
  zipf_estimate numeric
)
language sql
stable
as $$
  with suggested as (
    -- Every player suggestion, normalised by the game's own input rule.
    select
      lower(e.props ->> 'word') as word,
      lower(e.props ->> 'player_id') as player_id,
      e.created_at
    from public.analytics_events e
    where e.name = 'word_suggested'
      and e.props ? 'word'
      and lower(e.props ->> 'word') ~ '^[a-z]{2,30}$'
  ),
  asked as (
    select
      word,
      count(*) as suggestions,
      min(created_at) as first_suggested_at,
      max(created_at) as last_suggested_at
    from suggested
    group by 1
  ),
  askers as (
    -- One entry per player, in the order they first asked. An event from
    -- before the game sent a player id has nobody to name.
    select word, array_agg(player_id order by first_at, player_id) as suggesters
    from (
      select word, player_id, min(created_at) as first_at
      from suggested
      where player_id is not null
      group by 1, 2
    ) firsts
    group by 1
  )
  select
    coalesce(s.word, a.word) as word,
    case
      when s.outcome = 'playable' and a.word is not null then 'both'
      when s.outcome = 'playable' then 'live-lookup'
      else 'player'
    end as origin,
    s.zipf,
    coalesce(s.pos, '{}') as pos,
    s.first_use,
    s.source as mw_source,
    coalesce(s.lookups, 0)::integer as lookups,
    coalesce(a.suggestions, 0)::integer as suggestions,
    least(s.first_seen_at, a.first_suggested_at) as first_at,
    greatest(s.last_seen_at, a.last_suggested_at) as last_at,
    coalesce(s.status, 'new') as status,
    s.outcome,
    coalesce(k.suggesters, '{}') as suggesters,
    s.zipf_estimate
  from public.word_sightings s
  full outer join asked a on a.word = s.word
  left join askers k on k.word = coalesce(s.word, a.word)
  where s.word is null
     or s.outcome in ('playable', 'suggested')
  order by least(s.first_seen_at, a.first_suggested_at) desc,
           coalesce(s.word, a.word) asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_suggested_words(integer) is
  'Candidate words with their triage status, live MW verdict, the players who suggested them and any estimated Zipf, newest submission first, bounded. Read by api/review.ts.';

revoke all on function public.list_suggested_words(integer) from public, anon, authenticated;
grant execute on function public.list_suggested_words(integer) to service_role;
