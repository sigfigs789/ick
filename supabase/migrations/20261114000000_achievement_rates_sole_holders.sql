-- Name the player behind a badge only one player holds: the Stats page says
-- "Only earned by StormyFox47" (or "Only earned by you!" to that player) rather than "Under 1% of players".
--
-- `achievement_rates` gains `sole`, { achievement_id: handle } for every badge
-- with exactly one holder. The handle is the one the board already shows for
-- that player (`player_handle`, a port of src/game/handle.ts), so nothing new
-- about anyone leaves the server. Otherwise as in 20261113000000.

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
  ),
  counts as (
    select a.achievement_id, count(*) as n, min(a.player_id::text) as holder
    from public.player_achievements a
    join guessers g on g.player_id = a.player_id::text
    group by a.achievement_id
  )
  select jsonb_build_object(
    'players', (select count(*) from guessers),
    'earned', coalesce((select jsonb_object_agg(achievement_id, n) from counts), '{}'::jsonb),
    'sole', coalesce(
      (select jsonb_object_agg(achievement_id, public.player_handle(holder)) from counts where n = 1),
      '{}'::jsonb
    )
  );
$$;

comment on function public.achievement_rates() is
  'Players who have ever guessed, how many of them hold each achievement, and the handle of the one player holding a badge only one holds. Read by api/achievements.ts for the Stats page.';

revoke all on function public.achievement_rates() from public, anon, authenticated;
grant execute on function public.achievement_rates() to service_role;
