-- What Claude's estimated Zipf did to the game, for the /analytics page.
--
-- From the "Estimate unattested Zipf" workflow on, a word no frequency corpus
-- measures can score from a frequency Claude guessed (src/data/estimated-zipf.json)
-- instead of the unattested sentinel's flat 10.00 Legend. The client tags every
-- `answer_accepted` with `score_source` -- measured, estimated or unattested --
-- and this report reads that tag. Events from before the tag existed have none;
-- they count as answers but as no source, which is why the before/after
-- comparison leans on `rarity` and on `unattested_score_used` (which has always
-- fired for a sentinel score) rather than on the tag.
--
-- Three parts:
--   totals  -- the window's answers by source, the average score each source
--              earned, and how many players banked an estimated word
--   daily   -- the same per puzzle, for the chart
--   compare -- the same number of puzzles before and after the first estimated
--              one (up to 14 each): answers per player-day, the share of answers
--              that were Legends or sentinel scores, finishes, average answer
--              score, and next-day return. A comparison across dates, so other
--              changes in the same weeks (the 2026-10-07 score lift among them)
--              are in it too; it is a before/after, not an experiment.
--   retention -- after the first estimated puzzle, next-day return of
--              player-days that banked an estimated word against those that did
--              not. Players chose those words, so it is a correlation.
--
-- GitHub traffic is left out, as in every other report.

create or replace function public.estimated_score_report(p_days integer default 60, p_date date default null)
returns jsonb
language sql
stable
as $$
  with
  days as (
    select case when p_date is not null and p_days between 1 and 365 then p_days
      when p_days = 1 then 1 else greatest(7, least(coalesce(p_days, 60), 365)) end as n
  ),
  github_players as (
    select distinct e.props ->> 'player_id' as player_id
    from public.analytics_events e
    where e.props ->> 'player_id' is not null
      and (e.props ->> 'source' ~ '(^|\.)github(\.com|\.io)?$'
        or e.props ->> 'last_source' ~ '(^|\.)github(\.com|\.io)?$')
  ),
  -- Every play event this report reads, its date read safely: the endpoint is
  -- public, and one malformed row must not take the report down.
  events as (
    select
      e.name,
      e.props ->> 'player_id' as player_id,
      (e.props ->> 'puzzle_date')::date as puzzle_date,
      e.props ->> 'score_source' as score_source,
      e.props ->> 'rarity' as rarity,
      case when jsonb_typeof(e.props -> 'score') = 'number'
        then (e.props ->> 'score')::numeric end as score
    from public.analytics_events e
    where e.name in ('answer_accepted', 'unattested_score_used', 'puzzle_completed')
      and e.props ->> 'player_id' is not null
      and e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
      and not exists (
        select 1 from github_players g where g.player_id = e.props ->> 'player_id')
  ),
  answers as (select * from events where name = 'answer_accepted'),
  player_days as (select distinct player_id, puzzle_date from answers),
  -- The first puzzle any player banked an estimated word on: the change's start
  -- as the players met it, whatever the data file says.
  bounds as (
    select
      (select max(puzzle_date) from player_days) as as_of,
      coalesce(p_date, (select max(puzzle_date) from player_days)) as win_end,
      (select min(puzzle_date) from answers where score_source = 'estimated') as since
  ),
  win as (
    select b.win_end - (days.n - 1) as win_start, b.win_end, b.as_of, b.since
    from bounds b, days
  ),
  window_answers as (
    select a.* from answers a, win w where a.puzzle_date between w.win_start and w.win_end
  ),
  estimated_days as (
    select distinct player_id, puzzle_date from answers where score_source = 'estimated'
  ),

  totals as (
    select jsonb_build_object(
      'since', (select since from win),
      'answers', count(*),
      'estimated', count(*) filter (where score_source = 'estimated'),
      'unattested', count(*) filter (where score_source = 'unattested'),
      'measured', count(*) filter (where score_source = 'measured'),
      'players', count(distinct player_id),
      'finders', count(distinct player_id) filter (where score_source = 'estimated'),
      'avgScoreEstimated', round(avg(score) filter (where score_source = 'estimated'), 2),
      'avgScoreUnattested', round(avg(score) filter (where score_source = 'unattested'), 2),
      'avgScoreMeasured', round(avg(score) filter (where score_source = 'measured'), 2),
      'estimatedLegends', count(*) filter (where score_source = 'estimated' and rarity = 'Legend')
    ) as v
    from window_answers
  ),

  -- One row per puzzle in the window, from the first estimated one on: before
  -- it there is only a line of zeros for a change that had not shipped.
  daily as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', g.day,
      'answers', coalesce(a.answers, 0),
      'estimated', coalesce(a.estimated, 0),
      'unattested', coalesce(a.unattested, 0),
      'players', coalesce(a.players, 0),
      'finders', coalesce(a.finders, 0)
    ) order by g.day), '[]'::jsonb) as v
    from (
      select gs::date as day
      from win w, generate_series(greatest(w.win_start, w.since), w.win_end, interval '1 day') as gs
      where w.since is not null
    ) g
      left join (
        select puzzle_date,
          count(*) as answers,
          count(*) filter (where score_source = 'estimated') as estimated,
          count(*) filter (where score_source = 'unattested') as unattested,
          count(distinct player_id) as players,
          count(distinct player_id) filter (where score_source = 'estimated') as finders
        from window_answers group by puzzle_date
      ) a on a.puzzle_date = g.day
  ),

  -- Equal spans either side of the first estimated puzzle. The after side stops
  -- at the newest puzzle anybody has played; the before side is as long.
  spans as (
    select
      'before' as side,
      w.since - least(14, w.as_of - w.since + 1) as span_from,
      w.since - 1 as span_to
    from win w where w.since is not null
    union all
    select
      'after',
      w.since,
      w.since + least(14, w.as_of - w.since + 1) - 1
    from win w where w.since is not null
  ),
  span_stats as (
    select
      s.side,
      jsonb_build_object(
        'from', s.span_from,
        'to', s.span_to,
        'playerDays', (select count(*) from player_days d
                       where d.puzzle_date between s.span_from and s.span_to),
        'answers', (select count(*) from answers a
                    where a.puzzle_date between s.span_from and s.span_to),
        'legends', (select count(*) from answers a
                    where a.puzzle_date between s.span_from and s.span_to and a.rarity = 'Legend'),
        'unattested', (select count(*) from events e
                       where e.name = 'unattested_score_used'
                         and e.puzzle_date between s.span_from and s.span_to),
        'completions', (select count(distinct (e.player_id, e.puzzle_date)) from events e
                        where e.name = 'puzzle_completed'
                          and e.puzzle_date between s.span_from and s.span_to),
        'avgScore', (select round(avg(a.score), 2) from answers a
                     where a.puzzle_date between s.span_from and s.span_to),
        -- Next-day return, only for days whose next puzzle has been reached.
        'nextDay', (
          select jsonb_build_object(
            'cohort', count(*),
            'returned', count(*) filter (where exists (
              select 1 from player_days n
              where n.player_id = d.player_id and n.puzzle_date = d.puzzle_date + 1)))
          from player_days d, win w
          where d.puzzle_date between s.span_from and s.span_to and d.puzzle_date < w.as_of)
      ) as v
    from spans s
  ),
  compare as (
    select case when exists (select 1 from span_stats) then jsonb_build_object(
      'before', (select v from span_stats where side = 'before'),
      'after', (select v from span_stats where side = 'after')
    ) end as v
  ),

  next_day as (
    select
      exists (select 1 from estimated_days x
              where x.player_id = d.player_id and x.puzzle_date = d.puzzle_date) as found,
      exists (select 1 from player_days n
              where n.player_id = d.player_id and n.puzzle_date = d.puzzle_date + 1) as returned
    from player_days d, win w
    where w.since is not null
      and d.puzzle_date between greatest(w.win_start, w.since) and w.win_end
      and d.puzzle_date < w.as_of
  ),
  retention as (
    select jsonb_build_object(
      'nextDay', jsonb_build_object(
        'found', jsonb_build_object(
          'cohort', (select count(*) from next_day where found),
          'returned', (select count(*) from next_day where found and returned)),
        'other', jsonb_build_object(
          'cohort', (select count(*) from next_day where not found),
          'returned', (select count(*) from next_day where not found and returned)))
    ) as v
  )

  select jsonb_build_object(
    'totals', (select v from totals),
    'daily', (select v from daily),
    'compare', (select v from compare),
    'retention', (select v from retention)
  );
$$;

comment on function public.estimated_score_report(integer, date) is
  'Answers scored from Claude''s estimated Zipf, and the game before and after the first one, for the /analytics page. Read by api/review.ts alongside analytics_report.';

-- Explicit, for the reason every recent migration gives: service_role does not
-- inherit what public is given, and a clean stack grants it nothing by default.
revoke all on function public.estimated_score_report(integer, date) from public, anon, authenticated;
grant execute on function public.estimated_score_report(integer, date) to service_role;
