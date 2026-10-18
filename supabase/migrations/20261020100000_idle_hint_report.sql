-- idle_hint_report: the idle hint A/B test (see src/game/idleHint.ts), for the
-- /analytics page.
--
-- Two experiments, each a 50/50 split of its own players: `new` (a first-ever
-- session) and `returning` (any later session), both hinted after 5 seconds of
-- an empty word box. The client sends:
--
--   idle_hint_assigned        the draw, once per player per experiment.
--   idle_hint_triggered       the box sat empty for the delay. Both arms send
--                             it -- `shown` is true only for treatment -- with
--                             the first word hinted (or that would have been)
--                             and the rotation after it.
--   idle_hint_typed           the first keystroke after the trigger.
--   idle_hint_word_submitted  a word the hint loop had reached was submitted,
--                             either arm.
--
-- Most players type before the clock runs out and are never hinted, in either
-- arm, so comparing everybody assigned would bury the effect in players it
-- never touched. The numbers below are over the *triggered* players: those who
-- sat idle long enough to be hinted, whichever arm they were in. Each player
-- counts once per experiment, from their first trigger in the window, and
-- everything after is measured from that moment:
--
--   triggered    players who reached the threshold.
--   typed        typed into the box afterwards (within the day).
--   guessed      banked a word on the puzzle they were triggered on.
--   words        words banked on that puzzle after the trigger, summed.
--   bestScore    the best score banked after the trigger, summed over the
--                players who guessed (the page divides).
--   finished     completed that puzzle afterwards.
--   shared       copied or posted a result within the day.
--   usedHint     submitted a hinted word and had it accepted. In control
--                that is the word turning up on its own, which is the baseline.
--   medianVisibleMs  median of the player's visible time on site that day,
--                summed over the day's sessions.
--   returned     turned up again on any of the seven days after -- a visit or
--                a banked word, the same rule analytics_overview uses -- as a
--                closed-cohort rate (`cohort`/`returned`) and `soFar`.
--
-- `assigned` beside them is everybody drawn into the arm by the end of the
-- window -- everyone who could have been triggered in it, so the triggered
-- players are always a subset and the trigger rate is readable -- and so a
-- split that is not 50/50 is visible. (Counting only the draws inside the
-- window would leave out players assigned earlier and triggered inside it, and
-- push the rate over 100%.)
--
-- The window runs on the live puzzle the trigger happened on (`live_date`),
-- which is the day a visit, a share and a return are counted on; the puzzle
-- played can be an archived one, and the play numbers read that one
-- (`puzzle_date`). Excluded players are left out as in analytics_overview.

create or replace function public.idle_hint_report(
  p_from date default null,
  p_to date default null,
  p_today date default null
)
returns jsonb
language sql
stable
as $$
  with
  excluded_players as (
    select distinct e.props ->> 'player_id' as player_id
    from public.analytics_events e
    where e.props ->> 'player_id' is not null
      and (e.props ->> 'source' ~ '(^|\.)(github(\.com|\.io)?|vercel\.(com|app))$'
        or e.props ->> 'last_source' ~ '(^|\.)(github(\.com|\.io)?|vercel\.(com|app))$')
    union
    select player_id from public.analytics_excluded_players
  ),
  -- The experiment's own events. Dates and arms are checked before they are
  -- used: the endpoint that writes events is public, and one malformed row must
  -- not take the report down.
  hint_events as (
    select
      e.name,
      e.props ->> 'player_id' as player_id,
      e.props ->> 'experiment' as experiment,
      e.props ->> 'variant' as variant,
      e.props ->> 'puzzle_date' as puzzle_date,
      case when e.props ->> 'live_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_input_is_valid(e.props ->> 'live_date', 'date')
        then (e.props ->> 'live_date')::date end as live_day,
      e.props ->> 'word' as word,
      e.props ->> 'accepted' as accepted,
      e.created_at as at
    from public.analytics_events e
    where e.name in ('idle_hint_assigned', 'idle_hint_triggered', 'idle_hint_typed',
                     'idle_hint_word_submitted')
      and e.props ->> 'player_id' is not null
      and e.props ->> 'experiment' in ('new', 'returning')
      and e.props ->> 'variant' in ('control', 'treatment')
      and e.props ->> 'live_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pg_input_is_valid(e.props ->> 'live_date', 'date')
      and not exists (
        select 1 from excluded_players g where g.player_id = e.props ->> 'player_id')
  ),
  bounds as (
    select
      coalesce(p_today, max(live_day)) as today,
      coalesce(p_from, min(live_day)) as win_start,
      coalesce(p_to, max(live_day)) as win_end,
      min(live_day) filter (where name = 'idle_hint_triggered') as since
    from hint_events
  ),
  -- One arm per player per experiment, the first drawn.
  assigned as (
    select distinct on (h.player_id, h.experiment)
      h.player_id, h.experiment, h.variant, h.live_day
    from hint_events h
    where h.name = 'idle_hint_assigned'
    order by h.player_id, h.experiment, h.at
  ),
  cohort as (
    select distinct on (h.player_id, h.experiment)
      h.player_id, h.experiment, h.variant, h.puzzle_date, h.live_day, h.word, h.at
    from hint_events h
      cross join bounds b
    where h.name = 'idle_hint_triggered'
      and h.live_day between b.win_start and b.win_end
    order by h.player_id, h.experiment, h.at
  ),
  -- What the triggered players did, read once.
  later as (
    select
      e.name,
      e.props ->> 'player_id' as player_id,
      e.props ->> 'puzzle_date' as puzzle_date,
      e.props ->> 'session_id' as session_id,
      case when pg_input_is_valid(e.props ->> 'score', 'numeric')
        then (e.props ->> 'score')::numeric end as score,
      case when pg_input_is_valid(e.props ->> 'visible_ms', 'numeric')
        then (e.props ->> 'visible_ms')::numeric end as visible_ms,
      e.created_at as at
    from public.analytics_events e
    where e.name in ('answer_accepted', 'puzzle_completed', 'result_copied',
                     'result_shared_on_x', 'session_time')
      and e.props ->> 'player_id' in (select player_id from cohort)
  ),
  -- The days a player turned up on: a visit, or a word on the board.
  turned_up as (
    select distinct
      e.props ->> 'player_id' as player_id,
      case when e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
        then (e.props ->> 'puzzle_date')::date
        else (e.created_at at time zone 'America/Denver')::date
      end as day
    from public.analytics_events e
    where e.name = 'site_visit'
      and e.props ->> 'player_id' in (select player_id from cohort)
    union
    select distinct s.player_id::text, s.puzzle_date
    from public.leaderboard_scores s
    where s.player_id::text in (select player_id from cohort)
  ),
  per_player as (
    select
      c.experiment,
      c.variant,
      c.player_id,
      c.live_day + 7 < b.today as closed,
      exists (
        select 1 from hint_events h
        where h.name = 'idle_hint_typed' and h.player_id = c.player_id
          and h.experiment = c.experiment and h.at >= c.at and h.at < c.at + interval '1 day'
      ) as typed,
      (select count(*) from later l
       where l.name = 'answer_accepted' and l.player_id = c.player_id
         and l.puzzle_date = c.puzzle_date and l.at >= c.at) as words,
      (select max(l.score) from later l
       where l.name = 'answer_accepted' and l.player_id = c.player_id
         and l.puzzle_date = c.puzzle_date and l.at >= c.at) as best_score,
      exists (
        select 1 from later l
        where l.name = 'puzzle_completed' and l.player_id = c.player_id
          and l.puzzle_date = c.puzzle_date and l.at >= c.at
      ) as finished,
      exists (
        select 1 from later l
        where l.name in ('result_copied', 'result_shared_on_x') and l.player_id = c.player_id
          and l.at >= c.at and l.at < c.at + interval '1 day'
      ) as shared,
      exists (
        select 1 from hint_events h
        where h.name = 'idle_hint_word_submitted' and h.player_id = c.player_id
          and h.experiment = c.experiment and h.puzzle_date = c.puzzle_date
          and h.accepted = 'true' and h.at >= c.at
      ) as used_hint,
      (select sum(v.ms) from (
         select max(l.visible_ms) as ms from later l
         where l.name = 'session_time' and l.player_id = c.player_id
           and l.puzzle_date = c.live_day::text
         group by l.session_id) v) as visible_ms,
      exists (
        select 1 from turned_up t
        where t.player_id = c.player_id and t.day > c.live_day and t.day <= c.live_day + 7
      ) as returned
    from cohort c
      cross join bounds b
  ),
  arms as (
    select k.experiment, k.variant,
      jsonb_build_object(
        'assigned', (select count(*) from assigned a, bounds b
                     where a.experiment = k.experiment and a.variant = k.variant
                       and a.live_day <= b.win_end),
        'triggered', count(p.player_id),
        'typed', count(p.player_id) filter (where p.typed),
        'guessed', count(p.player_id) filter (where p.words > 0),
        'words', coalesce(sum(p.words), 0),
        'bestScore', coalesce(sum(p.best_score) filter (where p.words > 0), 0),
        'finished', count(p.player_id) filter (where p.finished),
        'shared', count(p.player_id) filter (where p.shared),
        'usedHint', count(p.player_id) filter (where p.used_hint),
        'medianVisibleMs', percentile_cont(0.5) within group (order by p.visible_ms)
                             filter (where p.visible_ms is not null),
        'returned', jsonb_build_object(
          'cohort', count(p.player_id) filter (where p.closed),
          'returned', count(p.player_id) filter (where p.closed and p.returned),
          'soFar', count(p.player_id) filter (where p.returned))
      ) as v
    from (values ('new', 'control'), ('new', 'treatment'),
                 ('returning', 'control'), ('returning', 'treatment')) as k(experiment, variant)
      left join per_player p on p.experiment = k.experiment and p.variant = k.variant
    group by k.experiment, k.variant
  )

  select jsonb_build_object(
    'today', (select today from bounds),
    'from', (select win_start from bounds),
    'to', (select win_end from bounds),
    'since', (select since from bounds),
    'experiments', (
      select coalesce(jsonb_object_agg(x.experiment, x.v), '{}'::jsonb)
      from (select experiment, jsonb_object_agg(variant, v) as v from arms group by experiment) x)
  );
$$;

comment on function public.idle_hint_report(date, date, date) is
  'The idle hint A/B test: per experiment (new, returning) and arm, the players who sat idle long enough to be hinted and what they went on to do, for the /analytics page. Read by api/review.ts.';

-- Explicit: service_role does not inherit what public is given, and a clean
-- stack grants it nothing by default.
revoke all on function public.idle_hint_report(date, date, date) from public, anon, authenticated;
grant execute on function public.idle_hint_report(date, date, date) to service_role;
