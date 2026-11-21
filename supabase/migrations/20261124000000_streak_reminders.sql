-- Streak reminders: web push subscriptions and who is due one today.
--
-- A player who has played three days can ask the browser to remind them when
-- their streak is about to end (see src/game/streakReminder.ts). The browser
-- hands over a push endpoint; this keeps it with the player's time zone and
-- `risk_date`, the local date their streak ends if it goes unplayed. The game
-- works that date out (a saved freeze or an earned rest day moves it) and
-- re-sends it after every play, so the server never has to know the rules.
--
-- The push carries no payload: the service worker (public/sw.js) shows a fixed
-- line, so nothing here needs the subscription's encryption keys.
--
-- scripts/send-streak-reminders.mjs runs every 15 minutes, asks
-- due_streak_reminders() who is past 11:30 am local time on their
-- risk_date, sends, and marks each one reminded for that date.

create table if not exists public.push_subscriptions (
  endpoint text primary key check (length(endpoint) <= 2048),
  player_id uuid,
  time_zone text not null,
  risk_date date,
  reminded_for date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

create or replace function public.upsert_push_subscription(
  p_endpoint text,
  p_player uuid,
  p_time_zone text,
  p_risk_date date
)
returns void
language plpgsql
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = p_time_zone) then
    raise exception 'unknown time zone %', p_time_zone;
  end if;
  insert into public.push_subscriptions (endpoint, player_id, time_zone, risk_date)
  values (p_endpoint, p_player, p_time_zone, p_risk_date)
  on conflict (endpoint) do update
    set player_id = excluded.player_id,
        time_zone = excluded.time_zone,
        risk_date = excluded.risk_date,
        updated_at = now();
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

-- Everyone whose streak ends today, local time is 11:30 or later, and who has
-- not been reminded for today yet.
create or replace function public.due_streak_reminders()
returns table (endpoint text, risk_date date)
language sql
stable
as $$
  select s.endpoint, s.risk_date
  from public.push_subscriptions s
  where s.risk_date is not null
    and s.risk_date = (now() at time zone s.time_zone)::date
    and (now() at time zone s.time_zone)::time >= time '11:30'
    and s.reminded_for is distinct from s.risk_date;
$$;

create or replace function public.mark_streak_reminded(p_endpoint text, p_date date)
returns void
language sql
as $$
  update public.push_subscriptions set reminded_for = p_date where endpoint = p_endpoint;
$$;

revoke all on function public.upsert_push_subscription(text, uuid, text, date) from public, anon, authenticated;
revoke all on function public.delete_push_subscription(text) from public, anon, authenticated;
revoke all on function public.due_streak_reminders() from public, anon, authenticated;
revoke all on function public.mark_streak_reminded(text, date) from public, anon, authenticated;
grant execute on function public.upsert_push_subscription(text, uuid, text, date) to service_role;
grant execute on function public.delete_push_subscription(text) to service_role;
grant execute on function public.due_streak_reminders() to service_role;
grant execute on function public.mark_streak_reminded(text, date) to service_role;
