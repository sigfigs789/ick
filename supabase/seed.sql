-- Sample leaderboard data for local development.
--
-- This file is *not* part of the schema and never runs against a deployed
-- project: `supabase db reset` applies it to the local stack only, after the
-- migrations. Production gets migrations and nothing else. Keeping the sample
-- data here rather than in a migration is what makes it dev-only by
-- construction rather than by remembering.
--
-- Dates are relative to `current_date`, so the data stays inside the weekly
-- window and the recent-finds feed however long it sits here. Nothing is dated
-- today: the feed deliberately withholds today's finds (they would be answers
-- to today's puzzle), so a row dated today would be invisible and misleading to
-- develop against.
--
-- Words are real dictionary entries with their real Zipf frequencies, so the
-- rarity badges and scores render exactly as they would in production.

truncate table public.leaderboard_scores, public.leaderboard_names;

insert into public.leaderboard_scores
  (player_id, puzzle_date, top_word, top_zipf, total_score, top_score, words)
values
  -- Six players, a week and a bit of history each, deliberately uneven so the
  -- boards have something to rank and the two of them disagree.
  ('11111111-1111-4111-8111-111111111111', current_date - 1, 'quixotic',           2.33, 24.8, 7.9,  4),
  ('11111111-1111-4111-8111-111111111111', current_date - 2, 'asphyxiate',         2.09, 27.4, 8.3,  5),
  ('11111111-1111-4111-8111-111111111111', current_date - 3, 'inkling',            2.90, 19.2, 7.1,  3),
  ('11111111-1111-4111-8111-111111111111', current_date - 5, 'wrinkle',            3.31, 15.0, 6.5,  3),
  ('11111111-1111-4111-8111-111111111111', current_date - 8, 'abaci',              2.65, 21.1, 7.5,  4),

  ('22222222-2222-4222-8222-222222222222', current_date - 1, 'stonyheartedly',    -1.57, 29.5, 10.0, 4),
  ('22222222-2222-4222-8222-222222222222', current_date - 2, 'placate',            3.40, 17.3, 6.4,  3),
  ('22222222-2222-4222-8222-222222222222', current_date - 4, 'inkling',            2.90, 18.0, 7.1,  3),
  ('22222222-2222-4222-8222-222222222222', current_date - 9, 'lactation',          3.20, 14.2, 6.8,  2),

  ('33333333-3333-4333-8333-333333333333', current_date - 1, 'gastroenterologist', 2.63, 22.0, 7.5,  4),
  ('33333333-3333-4333-8333-333333333333', current_date - 3, 'abaci',              2.65, 20.4, 7.5,  4),
  ('33333333-3333-4333-8333-333333333333', current_date - 6, 'cat',                4.78,  9.1, 4.3,  2),

  ('44444444-4444-4444-8444-444444444444', current_date - 2, 'inkling',            2.90, 16.6, 7.1,  3),
  ('44444444-4444-4444-8444-444444444444', current_date - 4, 'wrinkle',            3.31, 12.9, 6.5,  2),
  ('44444444-4444-4444-8444-444444444444', current_date - 7, 'quixotic',           2.33, 23.7, 7.9,  4),

  ('55555555-5555-4555-8555-555555555555', current_date - 3, 'placate',            3.40, 11.8, 6.4,  2),
  ('55555555-5555-4555-8555-555555555555', current_date - 5, 'cat',                4.78,  7.4, 4.3,  2),

  ('66666666-6666-4666-8666-666666666666', current_date - 1, 'inkling',            2.90, 13.5, 7.1,  2),
  ('66666666-6666-4666-8666-666666666666', current_date - 6, 'lactation',          3.20, 10.9, 6.8,  2);

-- One player has picked a name from their own finds rather than taking the
-- default, so the chosen-name path has something to exercise. `abaci` is one of
-- their own rows above, which is the only thing the setter will accept.
select public.choose_leaderboard_name(
  '11111111-1111-4111-8111-111111111111'::uuid,
  'abaci'
);
