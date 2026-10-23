import { lazy, type ComponentType } from "react";

/** When this tab last reloaded to recover a page chunk, in sessionStorage. */
const RELOADED_AT_KEY = "ick:chunk-reload-at";

/**
 * How long after one recovery reload a second failure is let through instead.
 * Long enough that a chunk which is genuinely broken surfaces as an error
 * rather than a reload loop; short enough not to matter to a returning player.
 */
const RELOAD_GUARD_MS = 30_000;

/**
 * A page that is its own chunk, fetched the first time it renders.
 *
 * `load` resolves the page's module and `pick` takes the component out of it --
 * the pages are named exports, and `lazy` wants a default.
 *
 * A failed fetch reloads the tab once. The usual cause is a tab left open
 * across a deploy: its chunk names are the old build's, and those files are
 * gone. A reload picks up the new build, and every bit of game state lives in
 * localStorage, so nothing is lost (the same reasoning as useForceUpdate).
 * Without it the page would throw and leave the player on a blank screen. A
 * second failure inside the guard window is thrown as normal.
 */
export function lazyPage<M>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType,
) {
  return lazy(async () => {
    try {
      return { default: pick(await load()) };
    } catch (error) {
      if (reloadToRecover()) return new Promise<never>(() => {});
      throw error;
    }
  });
}

/** Reload unless this tab already did so recently. True if it is reloading. */
function reloadToRecover(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
  } catch {
    // No sessionStorage, so no way to tell a first failure from a loop.
    return false;
  }
  window.location.reload();
  return true;
}
