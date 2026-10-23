/** When this tab last reloaded to recover a chunk, in sessionStorage. */
const RELOADED_AT_KEY = "ick:chunk-reload-at";

/**
 * How long after one recovery reload a second failure is let through instead.
 * Long enough that a chunk which is genuinely broken surfaces as an error
 * rather than a reload loop; short enough not to matter to a returning player.
 */
const RELOAD_GUARD_MS = 30_000;

/**
 * Reload the tab when one of the build's chunks fails to arrive.
 *
 * The usual cause is a tab left open across a deploy: its chunk names are the
 * old build's, and those files are gone (useForceUpdate deliberately leaves
 * such a tab alone for ordinary deploys). A reload picks up the new build, and
 * every bit of game state lives in localStorage, so nothing is lost.
 *
 * One listener for every chunk -- the pages, the emoji picker, the rejection
 * metadata, and whatever is split out next. Vite's build wraps each dynamic
 * import so that a failure fires `vite:preloadError` on window first; calling
 * `preventDefault` there makes the import resolve to `undefined` instead of
 * throwing (see lazyPage, which waits on that rather than rendering nothing).
 * A second failure inside the guard window is let through as an error, for the
 * page's error boundary to show.
 */
export function installChunkRecovery(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadToRecover()) event.preventDefault();
  });
}

/** Reload unless this tab already did so recently. True if it is reloading. */
export function reloadToRecover(): boolean {
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
