import { useEffect, useRef, type PointerEvent } from "react";

/** How long a press has to be held to open the reaction tray. */
export const HOLD_MS = 450;
/** How far a finger may drift before the press counts as a scroll instead. */
const HOLD_SLOP_PX = 10;

/**
 * Press-and-hold on a chat line, the way a phone's messages app reacts: after
 * `HOLD_MS` without lifting or scrolling away, `onHold` runs. The click and the
 * context menu the same press would otherwise raise are swallowed, so holding a
 * line does not also follow a link or open the browser's own menu.
 */
export function useHold(onHold: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  };

  useEffect(() => cancel, []);

  return {
    onPointerDown(event: PointerEvent) {
      fired.current = false;
      cancel();
      // The main button, or a touch; a right click has its own menu.
      if (event.button > 0) return;
      // A press on a control inside the line (a reaction chip) is that control's.
      if ((event.target as Element).closest?.("button")) return;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = undefined;
        fired.current = true;
        onHold();
      }, HOLD_MS);
    },
    onPointerMove(event: PointerEvent) {
      const from = start.current;
      if (!from) return;
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > HOLD_SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu(event: { preventDefault(): void }) {
      if (fired.current || timer.current !== undefined) event.preventDefault();
    },
    onClickCapture(event: { preventDefault(): void; stopPropagation(): void }) {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
