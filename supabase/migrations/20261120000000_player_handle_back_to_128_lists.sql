-- `public.player_handle` goes back to handleFor's original word lists: 128
-- adjectives and 128 nouns, reverting 20261119000000_player_handle_longer_lists
-- along with the TypeScript it ported. That migration has already run, so it
-- stays and this one replaces the function again rather than deleting it.
--
-- Every player gets their original handle back, here as on the board.
-- `analytics_excluded_players` is keyed by id, so nobody leaves it, and the
-- handles in its notes are current again.

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
