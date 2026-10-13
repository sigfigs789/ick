/**
 * What the paged views have already read, kept for the visit.
 *
 * Every page with a pager -- the boards, the finds, /folded-live, the chat's
 * rooms -- used to forget a window the moment a reader stepped off it, and
 * forget everything the moment they left the page. Stepping back, or coming
 * back from the puzzle, then showed a skeleton over something they had just
 * read. Each now keeps what it read here, shows it straight away when asked for
 * it again, and re-reads it underneath, so a window that moved still swaps in.
 *
 * Module scope rather than component state, so a page that unmounts on the way
 * to the puzzle finds its windows waiting when it comes back. Nothing is
 * persisted: a reload starts empty, which is also what keeps a cache from ever
 * outliving the deploy whose rules it was priced under.
 */
const caches: Map<string, unknown>[] = [];

/** A cache for one view, cleared with all the others by `forgetPageCaches`. */
export function pageCache<V>(): Map<string, V> {
  const cache = new Map<string, V>();
  caches.push(cache as Map<string, unknown>);
  return cache;
}

/** Empty every view's cache -- between tests, so one test's rows never seed the next. */
export function forgetPageCaches(): void {
  for (const cache of caches) cache.clear();
}
