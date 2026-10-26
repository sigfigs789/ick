-- Two more of the maintainer's own accounts are left out of analytics:
-- QuirkyWarbler52 and ElderDahlia31.
--
-- They are known by handle, the name the board shows, but the server never
-- stores a handle: it is a pure function of the player id (see
-- src/game/handle.ts). So the handle is computed here too, by
-- `public.player_handle`, a line-for-line port of `handleFor`, and every id
-- ever seen in the events or on the board whose handle is one of the two goes
-- on the hand-kept `analytics_excluded_players` list, which every analytics
-- report already reads.
--
-- A handle is not unique -- 1.6M of them, so a collision is unlikely at this
-- many players but not impossible -- and the ids taken are listed in the
-- notes this inserts, to check against. An id first seen after this runs is
-- not caught; a player's id is the same on every browser it is transferred
-- to, so that would be somebody else.

create or replace function public.player_handle(p_player_id text)
returns text
language plpgsql
immutable
strict
as $$
declare
  adjectives constant text[] := array[
    'Amber', 'Ancient', 'Arctic', 'Autumn', 'Balmy', 'Bold', 'Brave', 'Brisk',
    'Bronze', 'Calm', 'Candid', 'Cheery', 'Civic', 'Clever', 'Cloudy', 'Coastal',
    'Cobalt', 'Copper', 'Cosmic', 'Crimson', 'Crisp', 'Curious', 'Daring', 'Dawn',
    'Deft', 'Distant', 'Dusty', 'Eager', 'Early', 'Earnest', 'Eastern', 'Electric',
    'Elder', 'Emerald', 'Endless', 'Fabled', 'Fearless', 'Fleet', 'Fond', 'Forest',
    'Frosted', 'Gentle', 'Gilded', 'Glad', 'Golden', 'Graceful', 'Grand', 'Granite',
    'Hallowed', 'Hardy', 'Hazel', 'Hidden', 'Honest', 'Humble', 'Idle', 'Indigo',
    'Ivory', 'Jolly', 'Keen', 'Kindly', 'Lively', 'Lofty', 'Lucent', 'Lucky',
    'Lunar', 'Marble', 'Merry', 'Mighty', 'Mild', 'Misty', 'Modest', 'Mossy',
    'Nimble', 'Noble', 'Northern', 'Olive', 'Onyx', 'Opal', 'Patient', 'Pebble',
    'Placid', 'Plucky', 'Polar', 'Prairie', 'Prompt', 'Proper', 'Quiet', 'Quirky',
    'Rapid', 'Restless', 'Rosy', 'Royal', 'Rugged', 'Rustic', 'Sable', 'Sage',
    'Sandy', 'Scarlet', 'Serene', 'Sharp', 'Silent', 'Silver', 'Sleepy', 'Snowy',
    'Solar', 'Solemn', 'Sonic', 'Southern', 'Sparkling', 'Spry', 'Steady', 'Stellar',
    'Stormy', 'Sturdy', 'Sunny', 'Swift', 'Tidal', 'Timber', 'Tranquil', 'Trusty',
    'Twilight', 'Umber', 'Upland', 'Urban', 'Valiant', 'Velvet', 'Verdant', 'Vivid'
  ];
  nouns constant text[] := array[
    'Acorn', 'Alder', 'Anchor', 'Antler', 'Arbor', 'Arrow', 'Ash', 'Aspen',
    'Badger', 'Basin', 'Beacon', 'Bear', 'Beetle', 'Birch', 'Bison', 'Bramble',
    'Breeze', 'Brook', 'Canyon', 'Cedar', 'Chime', 'Cinder', 'Clover', 'Comet',
    'Compass', 'Coral', 'Cove', 'Crane', 'Creek', 'Crest', 'Dahlia', 'Delta',
    'Dune', 'Eagle', 'Ember', 'Falcon', 'Fathom', 'Fawn', 'Fennel', 'Fern',
    'Finch', 'Flint', 'Fox', 'Gale', 'Garnet', 'Glade', 'Glen', 'Grove',
    'Harbor', 'Hawk', 'Heather', 'Hedge', 'Heron', 'Hollow', 'Ibis', 'Isle',
    'Ivy', 'Jasper', 'Juniper', 'Kestrel', 'Lantern', 'Lark', 'Laurel', 'Ledge',
    'Lichen', 'Lily', 'Linden', 'Lynx', 'Magpie', 'Maple', 'Marsh', 'Meadow',
    'Mesa', 'Moss', 'Nectar', 'Nettle', 'Oak', 'Oriole', 'Osprey', 'Otter',
    'Owl', 'Pine', 'Pinion', 'Plover', 'Pollen', 'Poppy', 'Prairie', 'Quail',
    'Quarry', 'Quill', 'Rapids', 'Raven', 'Reef', 'Ridge', 'Rill', 'River',
    'Robin', 'Rook', 'Sable', 'Sage', 'Sequoia', 'Shale', 'Shore', 'Sparrow',
    'Spruce', 'Starling', 'Stone', 'Stream', 'Summit', 'Swallow', 'Sycamore', 'Talon',
    'Tamarind', 'Teal', 'Thicket', 'Thistle', 'Thorn', 'Tide', 'Timber', 'Torrent',
    'Trail', 'Tundra', 'Vale', 'Vine', 'Violet', 'Warbler', 'Willow', 'Wren'
  ];
  -- FNV-1a over the id's characters, as handleFor does. Its charCodeAt is a
  -- UTF-16 unit, which `ascii` matches for the ASCII ids crypto.randomUUID
  -- gives; an id outside that may hash differently, and is no id of ours.
  h bigint := 2166136261;
  i int;
begin
  for i in 1 .. length(p_player_id) loop
    h := h # ascii(substr(p_player_id, i, 1));
    h := (h * 16777619) % 4294967296;
  end loop;
  return adjectives[h % 128 + 1]
    || nouns[(h >> 8) % 128 + 1]
    || ((h >> 16) % 100)::text;
end;
$$;

comment on function public.player_handle(text) is
  'The handle the board shows for a player id: a port of handleFor in src/game/handle.ts, which it must match.';

insert into public.analytics_excluded_players (player_id, note)
select ids.player_id, public.player_handle(ids.player_id) || ': the maintainer'
from (
  select e.props ->> 'player_id' as player_id
  from public.analytics_events e
  where e.props ->> 'player_id' is not null
  union
  select s.player_id::text from public.leaderboard_scores s
) ids
where public.player_handle(ids.player_id) in ('QuirkyWarbler52', 'ElderDahlia31')
on conflict (player_id) do nothing;
