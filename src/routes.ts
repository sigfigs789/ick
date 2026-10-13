import { useEffect, useState } from "react";

/**
 * The whole router.
 *
 * Ten pages, no library. `vercel.json` already rewrites every non-`/api/` path
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
 * The last four are the word queue, the feedback players have left, the
 * Freeform week verdict, and the fold review, and they are no longer the same
 * kind of page. The queue is linked: suggest a word and
 * the sheet offers you the list it joined, because a queue of words is
 * everybody's. The feedback page is linked from nowhere -- a note is something
 * one player wrote to us, and the pile of them is not a page to hand the next
 * player. The freeform page is the same kind of thing again, and unlinked for
 * the same reason plus one of its own: it shows a running vote on a trial the
 * players are still in, and a tally is not a thing to put in front of the
 * people still voting. None has a tab; none is part of the daily round.
 *
 * `/fold` is the fourth of them and the furthest from a player: it is where the
 * scoring's own folds -- "timelinesses" scored as "time" -- are approved or
 * rejected one at a time, and what it writes eventually changes what a word is
 * worth (see FoldReviewPage). Unlinked, and unlike the others it is blank
 * without a key, because it is a page for whoever owns the scoring and nobody
 * else.
 *
 * `/folded-live` is the same question asked live, one puzzle at a time: the
 * words players banked that Standard scored as a common form, each with a
 * Reject that makes the word score as itself on that puzzle the moment it is
 * pressed (see components/FoldedLivePage.tsx). Unlinked, and not keyed: it is
 * meant to open without a password.
 *
 * `/analytics` is the maintainer's dashboard -- who plays, whether they come
 * back, and what that depends on. Unlinked, since a running account of how the
 * game is doing is not a page for the players, but not keyed: every number on
 * it is an aggregate, and it should open without a password (see
 * components/AnalyticsPage.tsx).
 *
 * `/transfer` is unlinked too, and for a reason of its own rather than an
 * editorial one: it is where a player moves themselves to a new browser, and
 * the string it deals in is the player id, which is the whole of an identity
 * here (see game/transfer.ts). Nothing in the game shows that id, so a page
 * that does had better be one nobody arrives at by wandering.
 *
 * `/help` is the index of all of the above, because nine pages, most of them
 * linked from nowhere, is more URLs than anyone remembers. Unlinked for the
 * same reason the curator pages are: it is mostly a list of them.
 *
 * Reading the notes and marking any row are both a curator's, and gated as
 * such: see api/review.ts.
 *
 * Anything that names none of them is the game, so a stray path still lands on a
 * playable puzzle rather than a 404 rendered by the client.
 */

export type Route =
  | "game"
  | "leaderboard"
  | "found-words"
  | "suggested-words"
  | "feedback"
  | "freeform-feedback"
  | "fold-review"
  | "folded-live"
  | "analytics"
  | "transfer"
  | "help";

export const LEADERBOARD_PATH = "/leaderboard";
export const FOUND_WORDS_PATH = "/found-words";
export const SUGGESTED_WORDS_PATH = "/suggested-words";
export const FEEDBACK_PATH = "/feedback";
export const FREEFORM_FEEDBACK_PATH = "/freeform-feedback";
export const FOLD_REVIEW_PATH = "/fold";
export const FOLDED_LIVE_PATH = "/folded-live";
export const ANALYTICS_PATH = "/analytics";
export const TRANSFER_PATH = "/transfer";
export const HELP_PATH = "/help";

/**
 * Whether the route lives in memory rather than in the address bar, and what it
 * is when it does.
 *
 * False everywhere on this site, and nothing here turns it on. It exists for a
 * host with no address bar to read: inside a Reddit post the game runs in a
 * sandboxed frame whose URL the player never sees, cannot link to, and cannot
 * reach with a back button -- and where a reload would ask the static server for
 * `/leaderboard`, which has no rewrite in front of it and no such file behind
 * it.
 *
 * The pages are still pages there; what changes is only where "which page" is
 * kept. The header's tabs are the whole of the navigation, which is what a
 * player inside a post has anyway.
 */
let inMemory = false;
let memoryRoute: Route = "game";

/**
 * Keep the route in memory instead of the address bar.
 *
 * Call once, before anything renders. The three unlinked curator pages become
 * unreachable when this is on, which is correct: they are reached by typing a
 * URL, and there is no URL to type.
 */
export function setInMemoryRouting(enabled: boolean): void {
  inMemory = enabled;
  memoryRoute = "game";
}

/** The route right now, from wherever this host keeps it. */
function currentRoute(): Route {
  return inMemory ? memoryRoute : routeFor(window.location.pathname);
}

/** The route a path names. */
export function routeFor(pathname: string): Route {
  // Tolerant of a trailing slash, since a shared link may well carry one.
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === LEADERBOARD_PATH) return "leaderboard";
  if (path === FOUND_WORDS_PATH) return "found-words";
  if (path === SUGGESTED_WORDS_PATH) return "suggested-words";
  if (path === FEEDBACK_PATH) return "feedback";
  if (path === FREEFORM_FEEDBACK_PATH) return "freeform-feedback";
  if (path === FOLD_REVIEW_PATH) return "fold-review";
  if (path === FOLDED_LIVE_PATH) return "folded-live";
  if (path === ANALYTICS_PATH) return "analytics";
  if (path === TRANSFER_PATH) return "transfer";
  if (path === HELP_PATH) return "help";
  return "game";
}

/** The path a route lives at. */
export function pathFor(route: Route): string {
  if (route === "leaderboard") return LEADERBOARD_PATH;
  if (route === "found-words") return FOUND_WORDS_PATH;
  if (route === "suggested-words") return SUGGESTED_WORDS_PATH;
  if (route === "feedback") return FEEDBACK_PATH;
  if (route === "freeform-feedback") return FREEFORM_FEEDBACK_PATH;
  if (route === "fold-review") return FOLD_REVIEW_PATH;
  if (route === "folded-live") return FOLDED_LIVE_PATH;
  if (route === "analytics") return ANALYTICS_PATH;
  if (route === "transfer") return TRANSFER_PATH;
  if (route === "help") return HELP_PATH;
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
  if (inMemory) {
    if (memoryRoute === route) return;
    memoryRoute = route;
    // The same wake-up the address bar's change sends, so `useRoute` has one
    // code path for "the route moved" whichever host it is running on.
    window.dispatchEvent(new PopStateEvent("popstate"));
    if (typeof window.scrollTo === "function") window.scrollTo(0, 0);
    return;
  }
  const path = pathFor(route);
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  // A new page starts at the top, the way following a link does. Guarded
  // because jsdom has no scrollTo, and a router is not worth a console error in
  // every test that changes page.
  if (typeof window.scrollTo === "function") window.scrollTo(0, 0);
}

/** The current route, kept in step with wherever this host keeps it. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => currentRoute());

  useEffect(() => {
    const sync = () => setRoute(currentRoute());
    window.addEventListener("popstate", sync);
    // Re-read on mount as well: the address bar is the source of truth, and it
    // can have moved between the initial state above and this effect running.
    sync();
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return route;
}
