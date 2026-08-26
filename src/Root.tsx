import { useEffect, useRef } from "react";
import App from "./App";
import { trackLeaderboardJoined } from "./analytics";
import { LeaderboardPage } from "./components/LeaderboardPage";
import { syncHistory } from "./game/leaderboard";
import { hasJoined, joinBoard } from "./game/player";
import { useRoute } from "./routes";

/**
 * How long a tab has to have been away before returning to it re-syncs.
 *
 * The same five minutes the leaderboard uses to decide a board has gone stale,
 * and for the same reason: flicking to another tab and back is not an absence,
 * and without a threshold every glance away would cost a POST. Long enough that
 * ordinary tab-switching is free, short enough that a phone put down and picked
 * up again counts as opening the app -- which, on a phone, it is.
 */
const SYNC_STALE_MS = 5 * 60_000;

/** Two pages, picked off the address bar. See src/routes.ts. */
export function Root() {
  const route = useRoute();

  /**
   * Give this browser a board identity, on any page, before anything renders.
   *
   * Playing is the joining. It used to be opening the leaderboard: that page
   * minted the id, and nothing left the browser until somebody went there -- so
   * a player could find a dozen good words and have none of them reach the
   * board or the finds feed, because the whole record of a day's play hung on
   * whether anyone had tapped a trophy.
   *
   * What the id *is* has not changed: a UUID this browser invents (see
   * game/player.ts), kept in localStorage and sent with scores. No account, no
   * email, nothing typed, nothing about the person -- the name on the board is
   * computed from the id itself. The trade is worth stating plainly: a player
   * who never opens the leaderboard is now on it, where before they were not.
   * What goes up is exactly what that page shows, and none of it reaches back
   * into the game.
   *
   * Minted during render rather than in the effect below, which is the one
   * unusual thing here and is load-bearing: child effects run *before* a
   * parent's, so a player landing straight on /leaderboard would have that page
   * read the id, find none, and ask for boards without saying who was asking.
   * Doing it here puts the id in place before any child renders. Safe to run
   * twice (StrictMode does): `joinBoard` keeps the first id and returns it.
   */
  const joinedBefore = useRef(hasJoined());
  const playerId = useRef<string | null>(null);
  if (playerId.current === null) playerId.current = joinBoard();

  /**
   * When this browser last sent its history, so a return can tell a tab that
   * has been away from one that never left.
   */
  const syncedAt = useRef(0);

  /**
   * Send what this browser knows, every open -- not only on the first mint.
   *
   * Rows are written as the player plays, one request per accepted word, and
   * any of those can fail to land: a tunnel, a tab closed on the last word, a
   * five-hundred from the endpoint. Nothing retried them. The per-day write is
   * monotonic, so re-sending is a repair rather than a rewrite -- a day already
   * recorded is a no-op, and only the gaps land.
   *
   * That covers all three ages of a player's record at once: the days they
   * played before this browser had an id at all, whatever is already stored for
   * today, and -- through `submitScore` on the play path -- each word as it is
   * accepted from here on.
   */
  useEffect(() => {
    // Reported for the browser that just became a player, and not on the opens
    // after it: the first one is the interesting moment, and firing on every
    // load would turn the event into a visit count that already exists.
    if (!joinedBefore.current && playerId.current) trackLeaderboardJoined(false);
    syncHistory();
    syncedAt.current = Date.now();
  }, []);

  /**
   * And again when the app is reopened without being reloaded.
   *
   * A mount is not the only way somebody opens this app, and on a phone it is
   * not even the usual way: a tab is backgrounded rather than closed, and coming
   * back to it runs no effect and remounts nothing. A player whose word failed
   * to submit at lunch would sit on that hole until they happened to reload.
   *
   * Two events, because there are two ways a tab reappears -- foregrounded
   * (`visibilitychange`), and restored from the back/forward cache (`pageshow`
   * with `persisted`, which does not remount React either). The same pair
   * useForceUpdate watches, for the same reason: these are the moments a tab
   * that has been sitting somewhere actually resurfaces.
   */
  useEffect(() => {
    const sync = () => {
      if (Date.now() - syncedAt.current < SYNC_STALE_MS) return;
      // Re-read rather than trusted from mount: a browser that could not store
      // an id (private mode, storage off) is not a player, and never becomes
      // one by coming back to the tab.
      if (!hasJoined()) return;
      syncHistory();
      syncedAt.current = Date.now();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) sync();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return route === "leaderboard" ? <LeaderboardPage /> : <App />;
}
