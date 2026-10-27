-- The badges each player holds, so the Stats page can say how many players hold
-- each one: "24% of players".
--
-- Achievements are worked out on the device (see src/game/achievements.ts) and
-- never left it, so the server could not count them. The game now sends the
-- ids it holds with every score it posts to /api/leaderboard; this keeps them.
-- One row per player per badge, written once and never updated: a badge is
-- kept for good on the device too.
--
-- Players from before this, and players who never update, are backfilled by
-- hand from scripts/achievement-rates.mts, which rebuilds each record from the
-- board's own tables.

create table if not exists public.player_achievements (
  player_id uuid not null,
  -- The game's own ids: "first-word", "streak-7", "mythic-10".
  achievement_id text not null check (achievement_id ~ '^[a-z0-9-]{1,40}$'),
  earned_on date not null,
  reported_at timestamptz not null default now(),
  primary key (player_id, achievement_id)
);

alter table public.player_achievements enable row level security;
revoke all on table public.player_achievements from public, anon, authenticated;
grant select, insert on table public.player_achievements to service_role;

-- The write: whatever the device says it holds, first report kept.
create or replace function public.submit_player_achievements(
  p_player_id uuid,
  p_achievements jsonb
)
returns void
language sql
as $$
  insert into public.player_achievements (player_id, achievement_id, earned_on)
  select p_player_id, a ->> 'id', (a ->> 'earnedOn')::date
  from jsonb_array_elements(p_achievements) a
  where a ->> 'id' ~ '^[a-z0-9-]{1,40}$'
    and a ->> 'earnedOn' ~ '^\d{4}-\d{2}-\d{2}$'
    and pg_input_is_valid(a ->> 'earnedOn', 'date')
  on conflict do nothing;
$$;

revoke all on function public.submit_player_achievements(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_player_achievements(uuid, jsonb) to service_role;

-- The read: how many players have ever guessed, and how many of them hold each
-- badge. "Guessed" is any word sent, accepted or turned away -- a banked word
-- is on the board, a turned-away one only in analytics. Bots, Muse, preview
-- deployments and the maintainer are left out as the analytics page leaves
-- them out.
create or replace function public.achievement_rates()
returns jsonb
language sql
stable
as $$
  with excluded as (
    select distinct props ->> 'player_id' as player_id
    from public.analytics_events
    where props ->> 'player_id' is not null and (
      props ->> 'visitor' = 'mos-muse'
      or (name = 'site_visit' and (props ->> 'webdriver' = 'true' or props ->> 'bot_ua' = 'true'
        or props ->> 'server_bot_ua' = 'true'))
      or coalesce(props ->> 'source', '') ~* '(^|\.)vercel\.(com|app)$'
      or coalesce(props ->> 'last_source', '') ~* '(^|\.)vercel\.(com|app)$')
    union select '87d3b6e1-322e-4928-acee-b4a7086c6e86'
    union select player_id from public.analytics_excluded_players
  ),
  guessers as (
    select player_id::text as player_id from public.leaderboard_scores
    union select player_id::text from public.leaderboard_finds
    union
    select props ->> 'player_id' from public.analytics_events
    where name in ('answer_accepted', 'answer_rejected') and props ->> 'player_id' is not null
    except select player_id from excluded
  )
  select jsonb_build_object(
    'players', (select count(*) from guessers),
    'earned', coalesce(
      (select jsonb_object_agg(achievement_id, n) from (
        select a.achievement_id, count(*) as n
        from public.player_achievements a
        join guessers g on g.player_id = a.player_id::text
        group by a.achievement_id
      ) counts),
      '{}'::jsonb
    )
  );
$$;

comment on function public.achievement_rates() is
  'Players who have ever guessed, and how many of them hold each achievement. Read by api/achievements.ts for the Stats page.';

revoke all on function public.achievement_rates() from public, anon, authenticated;
grant execute on function public.achievement_rates() to service_role;
