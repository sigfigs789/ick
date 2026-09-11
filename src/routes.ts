import { useEffect, useState } from "react";

/**
 * The whole router.
 *
 * Five pages, no library. `vercel.json` already rewrites every non-`/api/` path
 * to `index.html`, so a real URL is a matter of reading `location.pathname` and
 * pushing to it -- and both of the pages beside the game want a real URL: they
 * are pages you link someone to, open in a second tab, and reach with the back
 * button, none of which a modal can do.
 *
 * The boards and the finds are two of them rather than one long scroll. They
 * were one page, and the seam was always visible: a leaderboard row is a
 * *player* and a find is a *word*, they are read for different reasons, and the
 * one people come back through the day for -- the words -- sat under two boards
 * that had not moved since breakfast. Two pages, two links to send, and the
 * header says which one you are on.
 *
 * The last two -- the word queue and the feedback players have left -- began as
 * curator pages nothing linked to, and are now the page each sheet sends you to
 * once you have written something: suggest a word and you are offered the queue
 * it joined, leave a note and you are offered the wall it landed on. Public to
 * read, in other words, which is a decision about other people's words and not
 * a routing detail. They still have no tab, because they are not part of the
 * daily round.
 *
 * Marking a row is the part that stayed a curator's: see api/review.ts.
 *
 * Anything that names none of them is the game, so a stray path still lands on a
 * playable puzzle rather than a 404 rendered by the client.
 */

export type Route =
  | "game"
  | "leaderboard"
  | "found-words"
  | "suggested-words"
  | "feedback";

export const LEADERBOARD_PATH = "/leaderboard";
export const FOUND_WORDS_PATH = "/found-words";
export const SUGGESTED_WORDS_PATH = "/suggested-words";
export const FEEDBACK_PATH = "/feedback";

/** The route a path names. */
export function routeFor(pathname: string): Route {
  // Tolerant of a trailing slash, since a shared link may well carry one.
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === LEADERBOARD_PATH) return "leaderboard";
  if (path === FOUND_WORDS_PATH) return "found-words";
  if (path === SUGGESTED_WORDS_PATH) return "suggested-words";
  if (path === FEEDBACK_PATH) return "feedback";
  return "game";
}

/** The path a route lives at. */
export function pathFor(route: Route): string {
  if (route === "leaderboard") return LEADERBOARD_PATH;
  if (route === "found-words") return FOUND_WORDS_PATH;
  if (route === "suggested-words") return SUGGESTED_WORDS_PATH;
  if (route === "feedback") return FEEDBACK_PATH;
  return "/";
}

/**
 * Go to a route, adding a history entry so Back returns where the player was.
 *
 * `pushState` does not notify anything by itself, so a `popstate` is dispatched
 * to wake the subscribers below -- one code path for "the URL changed" whether
 * the change came from a click or from the back button.
 */
export function navigate(route: Route): void {
  const path = pathFor(route);
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  // A new page starts at the top, the way following a link does. Guarded
  // because jsdom has no scrollTo, and a router is not worth a console error in
  // every test that changes page.
  if (typeof window.scrollTo === "function") window.scrollTo(0, 0);
}

/** The current route, kept in step with the address bar. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFor(window.location.pathname));

  useEffect(() => {
    const sync = () => setRoute(routeFor(window.location.pathname));
    window.addEventListener("popstate", sync);
    // Re-read on mount as well: the address bar is the source of truth, and it
    // can have moved between the initial state above and this effect running.
    sync();
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return route;
}
