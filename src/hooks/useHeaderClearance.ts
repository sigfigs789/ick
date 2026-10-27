import { useEffect } from "react";

/** The custom property the header cards' `top` reads (see index.css). */
export const HEADER_CLEARANCE_PROPERTY = "--header-clearance";

/**
 * How far down the screen the header still reaches, in pixels: its bottom edge
 * while any of it is in view, 0 once it has scrolled away.
 */
export function headerClearance(header: Element | null): number {
  if (!header) return 0;
  return Math.max(0, Math.round(header.getBoundingClientRect().bottom));
}

/**
 * Keeps the header cards (the achievement, the streaks, yesterday's best word
 * and the rest) at the top of what the player can see without laying them over
 * the header: just under it while it is on screen, at the very top once it has
 * scrolled away. Written to a custom property on the root element and kept up
 * as the page scrolls or resizes, only while `active` -- a card is up.
 */
export function useHeaderClearance(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      const clearance = headerClearance(document.querySelector(".app__header"));
      root.style.setProperty(HEADER_CLEARANCE_PROPERTY, `${clearance}px`);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      root.style.removeProperty(HEADER_CLEARANCE_PROPERTY);
    };
  }, [active]);
}
