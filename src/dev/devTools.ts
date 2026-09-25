/**
 * Whether the developer affordances are available in this build: the "Reset
 * answers" button and the date bar.
 *
 * True in `npm run dev`, and true on a Vercel *preview* deploy -- the branch
 * builds opened from a pull request. A preview is where a change is actually
 * looked at, and looking at it usually means moving the date to reach the
 * puzzle that shows the change, or clearing answers to play a drop again. Doing
 * that on a phone, against a real deploy, is the whole point of a preview;
 * without these it means running the dev server on a laptop instead.
 *
 * Off by default on the production deploy, which is the build a player gets,
 * but switchable there by hand: opening the site with `?dev=1` turns the
 * affordances on for that browser and `?dev=0` turns them off again (see
 * `devToolsUnlocked` below). That is for checking something against the live
 * site itself, where a preview will not do. The switch is not a secret -- it is
 * in the bundle for anyone to read -- and it does not need to be one: the
 * server, not this flag, decides what a leaderboard post may claim, and in
 * production it refuses a puzzle date more than a day ahead (see
 * `futureDaysAllowed` in api/leaderboard.ts).
 *
 * The build half is read off a value Vite bakes in at build time (see
 * vite.config.ts, which sets VITE_DEV_TOOLS from Vercel's own VERCEL_ENV).
 *
 * Read through `import.meta.env` rather than a defined global, because these
 * modules are bundled by three different tools -- Vite for the website, Vite
 * again for the Devvit client, and Metro for the app, which answers
 * `import.meta.env` through a babel plugin (see
 * native/tools/babel-plugin-import-meta-env.cjs). A bare global would be a
 * ReferenceError in two of the three. Neither of the other two sets
 * VITE_DEV_TOOLS, so both get `undefined`, and both fall back to their own
 * development flag. The app has no address bar and no `location`, so the
 * `?dev` switch never fires there.
 */
const KEY = "ick:dev-tools";

export const DEV_TOOLS: boolean =
  import.meta.env.DEV ||
  import.meta.env.VITE_DEV_TOOLS === "1" ||
  devToolsUnlocked(
    typeof location === "undefined" ? "" : location.search,
    safeLocalStorage()
  );

/**
 * The hand-switched half of `DEV_TOOLS`. A `?dev=1` in the address records the
 * switch as on, `?dev=0` clears it, and with neither the last setting stands --
 * so the page keeps its tools through the reloads the date bar does, and from
 * a home-screen icon that opens without the query.
 */
export function devToolsUnlocked(search: string, storage: Storage | null): boolean {
  const asked = new URLSearchParams(search).get("dev");
  if (!storage) return asked === "1";
  try {
    if (asked === "1") storage.setItem(KEY, "1");
    else if (asked === "0") storage.removeItem(KEY);
    return storage.getItem(KEY) === "1";
  } catch {
    // Storage refused: honour the address for this page load only.
    return asked === "1";
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
