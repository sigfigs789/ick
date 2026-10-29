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

/** 128 adjectives x 128 nouns x 100 = 1.6M handles. See `handleFor` on why. */
const ADJECTIVES = [
  "Amber", "Ancient", "Arctic", "Autumn", "Balmy", "Bold", "Brave", "Brisk",
  "Bronze", "Calm", "Candid", "Cheery", "Civic", "Clever", "Cloudy", "Coastal",
  "Cobalt", "Copper", "Cosmic", "Crimson", "Crisp", "Curious", "Daring", "Dawn",
  "Deft", "Distant", "Dusty", "Eager", "Early", "Earnest", "Eastern", "Electric",
  "Elder", "Emerald", "Endless", "Fabled", "Fearless", "Fleet", "Fond", "Forest",
  "Frosted", "Gentle", "Gilded", "Glad", "Golden", "Graceful", "Grand", "Granite",
  "Hallowed", "Hardy", "Hazel", "Hidden", "Honest", "Humble", "Idle", "Indigo",
  "Ivory", "Jolly", "Keen", "Kindly", "Lively", "Lofty", "Lucent", "Lucky",
  "Lunar", "Marble", "Merry", "Mighty", "Mild", "Misty", "Modest", "Mossy",
  "Nimble", "Noble", "Northern", "Olive", "Onyx", "Opal", "Patient", "Pebble",
  "Placid", "Plucky", "Polar", "Prairie", "Prompt", "Proper", "Quiet", "Quirky",
  "Rapid", "Restless", "Rosy", "Royal", "Rugged", "Rustic", "Sable", "Sage",
  "Sandy", "Scarlet", "Serene", "Sharp", "Silent", "Silver", "Sleepy", "Snowy",
  "Solar", "Solemn", "Sonic", "Southern", "Sparkling", "Spry", "Steady", "Stellar",
  "Stormy", "Sturdy", "Sunny", "Swift", "Tidal", "Timber", "Tranquil", "Trusty",
  "Twilight", "Umber", "Upland", "Urban", "Valiant", "Velvet", "Verdant", "Vivid",
];

const NOUNS = [
  "Acorn", "Alder", "Anchor", "Antler", "Arbor", "Arrow", "Ash", "Aspen",
  "Badger", "Basin", "Beacon", "Bear", "Beetle", "Birch", "Bison", "Bramble",
  "Breeze", "Brook", "Canyon", "Cedar", "Chime", "Cinder", "Clover", "Comet",
  "Compass", "Coral", "Cove", "Crane", "Creek", "Crest", "Dahlia", "Delta",
  "Dune", "Eagle", "Ember", "Falcon", "Fathom", "Fawn", "Fennel", "Fern",
  "Finch", "Flint", "Fox", "Gale", "Garnet", "Glade", "Glen", "Grove",
  "Harbor", "Hawk", "Heather", "Hedge", "Heron", "Hollow", "Ibis", "Isle",
  "Ivy", "Jasper", "Juniper", "Kestrel", "Lantern", "Lark", "Laurel", "Ledge",
  "Lichen", "Lily", "Linden", "Lynx", "Magpie", "Maple", "Marsh", "Meadow",
  "Mesa", "Moss", "Nectar", "Nettle", "Oak", "Oriole", "Osprey", "Otter",
  "Owl", "Pine", "Pinion", "Plover", "Pollen", "Poppy", "Prairie", "Quail",
  "Quarry", "Quill", "Rapids", "Raven", "Reef", "Ridge", "Rill", "River",
  "Robin", "Rook", "Sable", "Sage", "Sequoia", "Shale", "Shore", "Sparrow",
  "Spruce", "Starling", "Stone", "Stream", "Summit", "Swallow", "Sycamore", "Talon",
  "Tamarind", "Teal", "Thicket", "Thistle", "Thorn", "Tide", "Timber", "Torrent",
  "Trail", "Tundra", "Vale", "Vine", "Violet", "Warbler", "Willow", "Wren",
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
 * number don't move together. The number is what makes duplicates unlikely
 * rather than merely uncommon: two words alone give about 16,000 handles, and at
 * a few hundred players duplicates would show up on the same board -- which on a
 * leaderboard is worse than an ugly name. With the number it is 1.6 million, and
 * a collision needs roughly a thousand players before it is likely at all.
 */
export function handleFor(playerId: string): string {
  const h = hash(playerId);
  const adjective = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[(h >>> 8) % NOUNS.length];
  const number = (h >>> 16) % 100;
  return `${adjective}${noun}${number}`;
}
