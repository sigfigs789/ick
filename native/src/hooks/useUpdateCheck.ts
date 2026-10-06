import { useCallback, useEffect, useRef, useState } from 'react';
import * as Updates from 'expo-updates';
import { APP_VERSION } from '../../../src/version';
import { useAppState } from './useAppState';

/**
 * How long the app has to have been away before a return checks again -- the
 * same threshold the history sync uses in App.tsx, for the same reason.
 */
const CHECK_STALE_MS = 5 * 60_000;

/**
 * Whether this build's scores still rank, and what to do when they do not.
 *
 * The leaderboard ranks only releases at or above `minRankedVersion`, which the
 * site publishes in /version.json (see MIN_RANKED_VERSION in src/version.ts).
 * The website can never be below it -- a tab below its floor reloads itself --
 * but this app is a copy of the game that only changes when it is updated.
 *
 * Below the floor, the first answer is an over-the-air update: the game is
 * JavaScript over the shared `src/`, so a scoring change almost always arrives
 * as one, and pulling it and reloading puts the player back on the board without
 * a trip to the store. The reload is the website's forced reload by another
 * name: everything a round needs is in storage, so the puzzle comes back exactly
 * where it was left.
 *
 * Only when there is no such update -- the change needed new native code, or
 * updates are off, as they are in development -- does this say `behind`, which
 * is what the banner in App.tsx shows for.
 *
 * Checked on open and on a return after an absence. A failed check changes
 * nothing: an app that cannot reach the site cannot rank either way, and a
 * banner telling a player offline to update would be wrong.
 */
export function useUpdateCheck(): { behind: boolean } {
  const [behind, setBehind] = useState(false);
  const checkedAt = useRef(0);

  const check = useCallback(() => {
    checkedAt.current = Date.now();
    void resolveBehind().then((answer) => {
      if (answer !== null) setBehind(answer);
    });
  }, []);

  useEffect(check, [check]);

  useAppState({
    onForeground: () => {
      if (Date.now() - checkedAt.current < CHECK_STALE_MS) return;
      check();
    },
  });

  return { behind };
}

/**
 * Whether this build is below the floor with nothing to pull, or null when there
 * is no answer: the site could not be read, or an update is reloading the app.
 */
async function resolveBehind(): Promise<boolean | null> {
  let floor: number;
  try {
    // Root-relative, which the fetch shim resolves against the site (see
    // host/net.ts). No-store, because this is the file that says the rules
    // moved, and a cached copy is the one answer it must not give.
    const response = await fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const { minRankedVersion } = (await response.json()) as { minRankedVersion?: unknown };
    if (typeof minRankedVersion !== 'number') return null;
    floor = minRankedVersion;
  } catch {
    return null;
  }

  if (APP_VERSION >= floor) return false;

  if (await pullUpdate()) return null;
  // Fall through to the banner: the store is the other way to update.
  return true;
}

/**
 * Download the over-the-air update, if there is one, and reload into it.
 *
 * True when the app is reloading; false when there was nothing to pull or the
 * pull failed -- updates off, offline, or no update published for this
 * runtime -- and the store is the way left. Shared by the check above and the
 * banner's button, which is the retry for a check that came up empty or failed
 * on a bad connection.
 */
export async function pullUpdate(): Promise<boolean> {
  if (!Updates.isEnabled) return false;
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (!isAvailable) return false;
    // Reload whether or not the fetch calls it new: an update the launch-time
    // check already downloaded is still one this copy is not running.
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
}
