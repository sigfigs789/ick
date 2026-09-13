import { useEffect, useState } from "react";

/**
 * The width at which the boards stop being one column.
 *
 * The same 64rem the stylesheet lays three boards side by side at (see
 * `.leaderboard__boards` in src/index.css). Written once here and once there
 * because a media query cannot be shared between CSS and JS -- but they are the
 * same line, and moving one without the other would leave the page picking a
 * board on a layout that is already showing all three.
 */
const WIDE_LAYOUT = "(min-width: 64rem)";

/**
 * Whether the page is in the narrow, one-column layout -- a phone, or a window
 * squeezed to the size of one.
 *
 * Only for things a stylesheet genuinely cannot do. Hiding or stacking is CSS's
 * job and stays there; this is for the case where the narrow layout shows a
 * *different set of things* -- one board a reader picks instead of three -- and
 * that is a question about what to render, which only the component can answer.
 *
 * Answers `false` where there is no `matchMedia` at all (jsdom, and any
 * server-side render): the wide layout is the whole page, so the fallback is
 * the one that shows everything rather than one third of it.
 */
export function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window.matchMedia !== "function") return false;
    return !window.matchMedia(WIDE_LAYOUT).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE_LAYOUT);
    // Read again on mount as well as on change: a resize between the first
    // render and this effect would otherwise never be heard about.
    setNarrow(!query.matches);
    const onChange = (event: MediaQueryListEvent) => setNarrow(!event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return narrow;
}
