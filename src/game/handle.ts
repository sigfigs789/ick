/**
 * The name the board calls a player: two words stuck together and a number,
 * like `StormyFox47`.
 *
 * Derived from the player's id rather than stored anywhere. A pure function of
 * the id means every browser computes the same name for the same player without
 * asking, the server never holds a display name at all, and there is no free-text
 * field to police -- nothing here is typed, so nothing here can impersonate.
 *
 * It replaced naming players after their rarest find, which was charming and
 * unreadable: on a page that also lists found words, a leaderboard row saying
 * `asphyxiate` gave no clue whether it was a person or a word. A capitalised
 * two-word handle is unmistakably a name, which is the whole job.
 *
 * The word lists are deliberately hand-written rather than drawn from the game's
 * dictionary. A dictionary pairing would eventually produce something unkind or
 * absurd, and nobody gets to choose their handle, so the floor matters more than
 * the ceiling. Everything here is mild on purpose.
 */

/**
 * 256 adjectives x 256 nouns x 100 = 6.5M handles. See `handleFor` on why.
 *
 * Each list is exactly 256 long so the adjective and the noun each take one
 * whole byte of the hash. Adding, removing or reordering a word renames
 * players, and `public.player_handle` in the Supabase migrations is a port of
 * these lists that has to change with them.
 */
export const ADJECTIVES = [
  "Agile", "Airy", "Alpine", "Amber", "Amiable", "Ancient", "Arctic", "Ardent",
  "Autumn", "Azure", "Balmy", "Beaming", "Blithe", "Bold", "Bonny", "Bouncy",
  "Brave", "Breezy", "Bright", "Brilliant", "Brisk", "Bronze", "Bubbly", "Buoyant",
  "Calm", "Candid", "Canny", "Carefree", "Cheerful", "Cheery", "Chipper", "Civic",
  "Clear", "Clever", "Cloudy", "Coastal", "Cobalt", "Copper", "Cordial", "Cosmic",
  "Cozy", "Crafty", "Crimson", "Crisp", "Curious", "Dapper", "Dappled", "Daring",
  "Dawn", "Dazzling", "Deft", "Dewy", "Distant", "Dreamy", "Dusky", "Dusty",
  "Eager", "Early", "Earnest", "Earthy", "Eastern", "Elder", "Electric", "Elegant",
  "Emerald", "Endless", "Epic", "Fabled", "Faithful", "Fancy", "Fearless", "Feathered",
  "Festive", "Fiery", "Fleet", "Fluent", "Fond", "Forest", "Fresh", "Friendly",
  "Frisky", "Frosted", "Gallant", "Genial", "Gentle", "Gilded", "Glad", "Gleaming",
  "Glowing", "Golden", "Graceful", "Gracious", "Grand", "Granite", "Hale", "Hallowed",
  "Happy", "Hardy", "Hazel", "Hearty", "Heroic", "Hidden", "Honest", "Hopeful",
  "Humble", "Hushed", "Icy", "Idle", "Indigo", "Inky", "Ivory", "Jade",
  "Jaunty", "Jolly", "Jovial", "Jubilant", "Keen", "Kind", "Kindly", "Kindred",
  "Leafy", "Limber", "Lively", "Lofty", "Loyal", "Lucent", "Lucky", "Lunar",
  "Lush", "Lyric", "Majestic", "Marble", "Maritime", "Mellow", "Merry", "Mighty",
  "Mild", "Misty", "Modest", "Moonlit", "Mossy", "Mystic", "Nautical", "Neat",
  "Nifty", "Nimble", "Noble", "Northern", "Oaken", "Oceanic", "Olive", "Onyx",
  "Opal", "Orderly", "Pastel", "Patient", "Peaceful", "Peachy", "Pearly", "Pebble",
  "Peppy", "Perky", "Placid", "Pleasant", "Plucky", "Plush", "Polar", "Polished",
  "Prairie", "Prompt", "Proper", "Proud", "Quick", "Quiet", "Quirky", "Radiant",
  "Rainy", "Rapid", "Ready", "Regal", "Restless", "Rocky", "Rosy", "Royal",
  "Ruby", "Rugged", "Russet", "Rustic", "Sable", "Sage", "Sandy", "Scarlet",
  "Scenic", "Serene", "Sharp", "Sheltered", "Shiny", "Silent", "Silver", "Sleepy",
  "Smooth", "Snowy", "Snug", "Solar", "Solemn", "Sonic", "Southern", "Sparkling",
  "Spirited", "Splendid", "Spry", "Starry", "Steady", "Stellar", "Stormy", "Sturdy",
  "Sunlit", "Sunny", "Supple", "Swift", "Tawny", "Tender", "Thrifty", "Tidal",
  "Tidy", "Timber", "Tranquil", "True", "Trusty", "Twilight", "Umber", "Unhurried",
  "Upbeat", "Upland", "Urban", "Valiant", "Vast", "Velvet", "Verdant", "Vernal",
  "Vivid", "Wandering", "Warm", "Wavy", "Western", "Whimsical", "Wild", "Winding",
  "Windy", "Wintry", "Wise", "Witty", "Woolly", "Zany", "Zesty", "Zippy",
];

export const NOUNS = [
  "Acacia", "Acorn", "Albatross", "Alder", "Amethyst", "Anchor", "Antler", "Apricot",
  "Arbor", "Arrow", "Ash", "Aspen", "Aurora", "Badger", "Basil", "Basin",
  "Bay", "Bayou", "Beacon", "Bear", "Beaver", "Beech", "Beetle", "Birch",
  "Bison", "Bluebell", "Bluff", "Bobcat", "Boulder", "Bramble", "Breeze", "Briar",
  "Brook", "Butte", "Buttercup", "Canyon", "Cardinal", "Caribou", "Cascade", "Cedar",
  "Chestnut", "Chickadee", "Chime", "Cinder", "Cliff", "Cloud", "Clover", "Comet",
  "Compass", "Condor", "Coral", "Cormorant", "Cougar", "Cove", "Crag", "Crane",
  "Creek", "Crest", "Cricket", "Crocus", "Cypress", "Dahlia", "Daisy", "Dell",
  "Delta", "Dew", "Dolphin", "Dove", "Driftwood", "Dune", "Eagle", "Egret",
  "Elk", "Elm", "Ember", "Estuary", "Falcon", "Fathom", "Fawn", "Fennel",
  "Fern", "Finch", "Fir", "Fjord", "Flint", "Fox", "Foxglove", "Frost",
  "Galaxy", "Gale", "Gannet", "Garnet", "Gazelle", "Geyser", "Glacier", "Glade",
  "Glen", "Goldfinch", "Gorge", "Grouse", "Grove", "Gull", "Harbor", "Hare",
  "Harrier", "Hawk", "Heath", "Heather", "Hedge", "Hemlock", "Heron", "Hickory",
  "Hollow", "Holly", "Ibex", "Ibis", "Iris", "Island", "Isle", "Ivy",
  "Jasper", "Jay", "Juniper", "Kelp", "Kestrel", "Kingfisher", "Kite", "Lagoon",
  "Lantern", "Larch", "Lark", "Laurel", "Ledge", "Lichen", "Lily", "Linden",
  "Loon", "Lotus", "Lupine", "Lynx", "Magnolia", "Magpie", "Mallard", "Mangrove",
  "Maple", "Marigold", "Marsh", "Marten", "Meadow", "Mesa", "Meteor", "Minnow",
  "Mint", "Moose", "Moss", "Narwhal", "Nebula", "Nectar", "Nettle", "Newt",
  "Nightjar", "Oak", "Oasis", "Ocelot", "Orbit", "Orca", "Orchid", "Oriole",
  "Osprey", "Otter", "Owl", "Panda", "Pelican", "Peony", "Petrel", "Pheasant",
  "Pine", "Pinion", "Planet", "Plover", "Plume", "Pollen", "Pond", "Poppy",
  "Prairie", "Primrose", "Puffin", "Puma", "Quail", "Quarry", "Quartz", "Quill",
  "Rabbit", "Rapids", "Raven", "Reed", "Reef", "Ridge", "Rill", "River",
  "Robin", "Rook", "Rowan", "Sable", "Sage", "Salmon", "Sandpiper", "Sequoia",
  "Shale", "Shore", "Skylark", "Snowdrop", "Sparrow", "Spire", "Spruce", "Squirrel",
  "Starling", "Stone", "Stork", "Stream", "Summit", "Sunflower", "Swallow", "Swan",
  "Sycamore", "Talon", "Tamarind", "Teal", "Tern", "Thicket", "Thistle", "Thorn",
  "Thrush", "Thyme", "Tide", "Timber", "Torrent", "Tortoise", "Trail", "Trout",
  "Tulip", "Tundra", "Vale", "Valley", "Vine", "Violet", "Walrus", "Warbler",
  "Whale", "Willow", "Wisteria", "Wolf", "Wren", "Yarrow", "Yew", "Zephyr",
];

/**
 * A stable 32-bit hash of a string (FNV-1a).
 *
 * Chosen for being short, dependency-free and *fixed*: a player's handle must be
 * the same on every device and every release, so this can never be swapped for
 * something with better distribution without renaming everybody.
 */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    // The FNV prime, by shift-and-add: a plain multiply would overflow into
    // floating point and lose the low bits the next round depends on.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * The handle for a player id.
 *
 * Three independent slices of the hash, so the adjective, the noun and the
 * number don't move together: bits 0-7, 8-15 and 16-31. The number is what
 * makes duplicates unlikely rather than merely uncommon: two words alone give
 * about 65,000 handles, and at several hundred players duplicates would show up
 * on the same board -- which on a leaderboard is worse than an ugly name. With
 * the number it is 6.5 million, and a collision needs roughly three thousand
 * players before it is likely at all.
 *
 * The lists were 128 long until they started to feel repetitive: with a few
 * hundred players, every adjective was on the board a few times over.
 */
export function handleFor(playerId: string): string {
  const h = hash(playerId);
  const adjective = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[(h >>> 8) % NOUNS.length];
  const number = (h >>> 16) % 100;
  return `${adjective}${noun}${number}`;
}
