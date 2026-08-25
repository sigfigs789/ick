import { useEffect, useState } from "react";

/**
 * The whole router.
 *
 * Two pages, no library. `vercel.json` already rewrites every non-`/api/` path
 * to `index.html`, so a real URL is a matter of reading `location.pathname` and
 * pushing to it -- and a leaderboard wants a real URL: it is a page you link
 * someone to, open in a second tab, and reach with the back button, none of
 * which a modal can do.
 *
 * Anything that isn't the leaderboard is the game, so a stray path still lands
 * on a playable puzzle rather than a 404 rendered by the client.
 */

export type Route = "game" | "leaderboard";

export const LEADERBOARD_PATH = "/leaderboard";

/** The route a path names. */
export function routeFor(pathname: string): Route {
  // Tolerant of a trailing slash, since a shared link may well carry one.
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === LEADERBOARD_PATH ? "leaderboard" : "game";
}

/** The path a route lives at. */
export function pathFor(route: Route): string {
  return route === "leaderboard" ? LEADERBOARD_PATH : "/";
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
