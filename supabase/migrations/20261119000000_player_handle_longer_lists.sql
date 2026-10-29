-- `public.player_handle` follows handleFor in src/game/handle.ts to its longer
-- word lists: 256 adjectives and 256 nouns, up from 128 each, because the
-- handles had started to feel repetitive. Each list is now exactly one byte of
-- the hash, so the slices are bits 0-7, 8-15 and 16-31.
--
-- Every player gets a new handle, here as on the board: the function has to
-- keep matching the TypeScript it ports. The players already on
-- `analytics_excluded_players` are listed there by id, so they stay excluded;
-- only the handle in their notes is now out of date.

create or replace function public.player_handle(p_player_id text)
returns text
language plpgsql
immutable
strict
as $$
declare
  adjectives constant text[] := array[
    'Agile', 'Airy', 'Alpine', 'Amber', 'Amiable', 'Ancient', 'Arctic', 'Ardent',
    'Autumn', 'Azure', 'Balmy', 'Beaming', 'Blithe', 'Bold', 'Bonny', 'Bouncy',
    'Brave', 'Breezy', 'Bright', 'Brilliant', 'Brisk', 'Bronze', 'Bubbly', 'Buoyant',
    'Calm', 'Candid', 'Canny', 'Carefree', 'Cheerful', 'Cheery', 'Chipper', 'Civic',
    'Clear', 'Clever', 'Cloudy', 'Coastal', 'Cobalt', 'Copper', 'Cordial', 'Cosmic',
    'Cozy', 'Crafty', 'Crimson', 'Crisp', 'Curious', 'Dapper', 'Dappled', 'Daring',
    'Dawn', 'Dazzling', 'Deft', 'Dewy', 'Distant', 'Dreamy', 'Dusky', 'Dusty',
    'Eager', 'Early', 'Earnest', 'Earthy', 'Eastern', 'Elder', 'Electric', 'Elegant',
    'Emerald', 'Endless', 'Epic', 'Fabled', 'Faithful', 'Fancy', 'Fearless', 'Feathered',
    'Festive', 'Fiery', 'Fleet', 'Fluent', 'Fond', 'Forest', 'Fresh', 'Friendly',
    'Frisky', 'Frosted', 'Gallant', 'Genial', 'Gentle', 'Gilded', 'Glad', 'Gleaming',
    'Glowing', 'Golden', 'Graceful', 'Gracious', 'Grand', 'Granite', 'Hale', 'Hallowed',
    'Happy', 'Hardy', 'Hazel', 'Hearty', 'Heroic', 'Hidden', 'Honest', 'Hopeful',
    'Humble', 'Hushed', 'Icy', 'Idle', 'Indigo', 'Inky', 'Ivory', 'Jade',
    'Jaunty', 'Jolly', 'Jovial', 'Jubilant', 'Keen', 'Kind', 'Kindly', 'Kindred',
    'Leafy', 'Limber', 'Lively', 'Lofty', 'Loyal', 'Lucent', 'Lucky', 'Lunar',
    'Lush', 'Lyric', 'Majestic', 'Marble', 'Maritime', 'Mellow', 'Merry', 'Mighty',
    'Mild', 'Misty', 'Modest', 'Moonlit', 'Mossy', 'Mystic', 'Nautical', 'Neat',
    'Nifty', 'Nimble', 'Noble', 'Northern', 'Oaken', 'Oceanic', 'Olive', 'Onyx',
    'Opal', 'Orderly', 'Pastel', 'Patient', 'Peaceful', 'Peachy', 'Pearly', 'Pebble',
    'Peppy', 'Perky', 'Placid', 'Pleasant', 'Plucky', 'Plush', 'Polar', 'Polished',
    'Prairie', 'Prompt', 'Proper', 'Proud', 'Quick', 'Quiet', 'Quirky', 'Radiant',
    'Rainy', 'Rapid', 'Ready', 'Regal', 'Restless', 'Rocky', 'Rosy', 'Royal',
    'Ruby', 'Rugged', 'Russet', 'Rustic', 'Sable', 'Sage', 'Sandy', 'Scarlet',
    'Scenic', 'Serene', 'Sharp', 'Sheltered', 'Shiny', 'Silent', 'Silver', 'Sleepy',
    'Smooth', 'Snowy', 'Snug', 'Solar', 'Solemn', 'Sonic', 'Southern', 'Sparkling',
    'Spirited', 'Splendid', 'Spry', 'Starry', 'Steady', 'Stellar', 'Stormy', 'Sturdy',
    'Sunlit', 'Sunny', 'Supple', 'Swift', 'Tawny', 'Tender', 'Thrifty', 'Tidal',
    'Tidy', 'Timber', 'Tranquil', 'True', 'Trusty', 'Twilight', 'Umber', 'Unhurried',
    'Upbeat', 'Upland', 'Urban', 'Valiant', 'Vast', 'Velvet', 'Verdant', 'Vernal',
    'Vivid', 'Wandering', 'Warm', 'Wavy', 'Western', 'Whimsical', 'Wild', 'Winding',
    'Windy', 'Wintry', 'Wise', 'Witty', 'Woolly', 'Zany', 'Zesty', 'Zippy'
  ];
  nouns constant text[] := array[
    'Acacia', 'Acorn', 'Albatross', 'Alder', 'Amethyst', 'Anchor', 'Antler', 'Apricot',
    'Arbor', 'Arrow', 'Ash', 'Aspen', 'Aurora', 'Badger', 'Basil', 'Basin',
    'Bay', 'Bayou', 'Beacon', 'Bear', 'Beaver', 'Beech', 'Beetle', 'Birch',
    'Bison', 'Bluebell', 'Bluff', 'Bobcat', 'Boulder', 'Bramble', 'Breeze', 'Briar',
    'Brook', 'Butte', 'Buttercup', 'Canyon', 'Cardinal', 'Caribou', 'Cascade', 'Cedar',
    'Chestnut', 'Chickadee', 'Chime', 'Cinder', 'Cliff', 'Cloud', 'Clover', 'Comet',
    'Compass', 'Condor', 'Coral', 'Cormorant', 'Cougar', 'Cove', 'Crag', 'Crane',
    'Creek', 'Crest', 'Cricket', 'Crocus', 'Cypress', 'Dahlia', 'Daisy', 'Dell',
    'Delta', 'Dew', 'Dolphin', 'Dove', 'Driftwood', 'Dune', 'Eagle', 'Egret',
    'Elk', 'Elm', 'Ember', 'Estuary', 'Falcon', 'Fathom', 'Fawn', 'Fennel',
    'Fern', 'Finch', 'Fir', 'Fjord', 'Flint', 'Fox', 'Foxglove', 'Frost',
    'Galaxy', 'Gale', 'Gannet', 'Garnet', 'Gazelle', 'Geyser', 'Glacier', 'Glade',
    'Glen', 'Goldfinch', 'Gorge', 'Grouse', 'Grove', 'Gull', 'Harbor', 'Hare',
    'Harrier', 'Hawk', 'Heath', 'Heather', 'Hedge', 'Hemlock', 'Heron', 'Hickory',
    'Hollow', 'Holly', 'Ibex', 'Ibis', 'Iris', 'Island', 'Isle', 'Ivy',
    'Jasper', 'Jay', 'Juniper', 'Kelp', 'Kestrel', 'Kingfisher', 'Kite', 'Lagoon',
    'Lantern', 'Larch', 'Lark', 'Laurel', 'Ledge', 'Lichen', 'Lily', 'Linden',
    'Loon', 'Lotus', 'Lupine', 'Lynx', 'Magnolia', 'Magpie', 'Mallard', 'Mangrove',
    'Maple', 'Marigold', 'Marsh', 'Marten', 'Meadow', 'Mesa', 'Meteor', 'Minnow',
    'Mint', 'Moose', 'Moss', 'Narwhal', 'Nebula', 'Nectar', 'Nettle', 'Newt',
    'Nightjar', 'Oak', 'Oasis', 'Ocelot', 'Orbit', 'Orca', 'Orchid', 'Oriole',
    'Osprey', 'Otter', 'Owl', 'Panda', 'Pelican', 'Peony', 'Petrel', 'Pheasant',
    'Pine', 'Pinion', 'Planet', 'Plover', 'Plume', 'Pollen', 'Pond', 'Poppy',
    'Prairie', 'Primrose', 'Puffin', 'Puma', 'Quail', 'Quarry', 'Quartz', 'Quill',
    'Rabbit', 'Rapids', 'Raven', 'Reed', 'Reef', 'Ridge', 'Rill', 'River',
    'Robin', 'Rook', 'Rowan', 'Sable', 'Sage', 'Salmon', 'Sandpiper', 'Sequoia',
    'Shale', 'Shore', 'Skylark', 'Snowdrop', 'Sparrow', 'Spire', 'Spruce', 'Squirrel',
    'Starling', 'Stone', 'Stork', 'Stream', 'Summit', 'Sunflower', 'Swallow', 'Swan',
    'Sycamore', 'Talon', 'Tamarind', 'Teal', 'Tern', 'Thicket', 'Thistle', 'Thorn',
    'Thrush', 'Thyme', 'Tide', 'Timber', 'Torrent', 'Tortoise', 'Trail', 'Trout',
    'Tulip', 'Tundra', 'Vale', 'Valley', 'Vine', 'Violet', 'Walrus', 'Warbler',
    'Whale', 'Willow', 'Wisteria', 'Wolf', 'Wren', 'Yarrow', 'Yew', 'Zephyr'
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
  return adjectives[h % 256 + 1]
    || nouns[(h >> 8) % 256 + 1]
    || ((h >> 16) % 100)::text;
end;
$$;

comment on function public.player_handle(text) is
  'The handle the board shows for a player id: a port of handleFor in src/game/handle.ts, which it must match.';
