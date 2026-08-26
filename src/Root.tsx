import { useEffect, useRef } from "react";
import App from "./App";
import { LeaderboardPage } from "./components/LeaderboardPage";
import { syncHistory } from "./game/leaderboard";
import { hasJoined } from "./game/player";
import { useRoute } from "./routes";

/** Two pages, picked off the address bar. See src/routes.ts. */
export function Root() {
  const route = useRoute();

  /**
   * Bring a player who is already on the board up to date, whichever page they
   * opened.
   *
   * Their rows are written as they play, one request per accepted word, and any
   * of those can fail to land -- a subway tunnel, a tab closed on the last word,
   * a five-hundred from the endpoint. Nothing retried them: the only other path
   * that sends a whole history ran on joining, once, so a player who joined in
   * August and lost a day in September stayed missing that day forever.
   *
   * Read before any child effect can run (a ref initialiser is render-time,
   * child effects are not), so a player who joins by opening the leaderboard on
   * this very load is not synced twice -- that page's own join already sends
   * their history, and this would send the same request behind it.
   *
   * Once per load, not per route change: the two pages share this mount, and
   * repairing the same history again on a tap through to the leaderboard would
   * be a second identical request for nothing.
   */
  const joinedOnOpen = useRef(hasJoined());
  useEffect(() => {
    if (joinedOnOpen.current) syncHistory();
  }, []);

  return route === "leaderboard" ? <LeaderboardPage /> : <App />;
}
