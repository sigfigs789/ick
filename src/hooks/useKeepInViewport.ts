import { useLayoutEffect, type RefObject } from "react";

/** The gap kept between a popup and the screen's edge, in px (1rem). */
const EDGE = 16;

/**
 * Nudges the popup in `ref` sideways, while `open`, so it stays on screen: a
 * popup centred on a badge near the screen's edge would otherwise hang off
 * it. Uses the `translate` property, so whatever `transform` the stylesheet
 * places it with still applies. When there's no room above it, it opens
 * below instead (`rest-day__popup--below`).
 */
export function useKeepInViewport(ref: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const popup = ref.current;
    if (!open || !popup) return;
    const place = () => {
      popup.style.translate = "";
      popup.classList.remove("rest-day__popup--below");
      const width = document.documentElement.clientWidth;
      const rect = popup.getBoundingClientRect();
      let shift = 0;
      if (rect.left < EDGE) shift = EDGE - rect.left;
      else if (rect.right > width - EDGE) shift = Math.max(width - EDGE - rect.right, EDGE - rect.left);
      if (shift) popup.style.translate = `${shift}px 0`;
      if (rect.top < 0) popup.classList.add("rest-day__popup--below");
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [ref, open]);
}
