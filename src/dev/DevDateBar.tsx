import { addDays, todayDateString, toDateString } from "../game/date";
import { devDateOverride, setDevDateOverride } from "./devDate";

/**
 * The dev-only time machine: a date picker, a day either side of it, and a way
 * back to the real today.
 *
 * Every change reloads the page rather than re-rendering. Dates are read once
 * per mount all over this app -- `useDailyPuzzle` memoises today, Root holds it
 * in a ref, the boards take it in `useState` -- which is right for a real
 * player, whose today does not move under them, and is exactly what moving it
 * has to work around. A reload is the honest version of what changing the date
 * means: the app opened on that day.
 *
 * Rendered only under `import.meta.env.DEV`, so nothing here reaches a
 * production bundle. See src/dev/devDate.ts.
 */
export function DevDateBar() {
  if (!import.meta.env.DEV) return null;

  const override = devDateOverride();
  const today = todayDateString();
  const real = toDateString(new Date());

  function go(date: string | null) {
    setDevDateOverride(date);
    window.location.reload();
  }

  return (
    <div className="dev-date-bar">
      <button type="button" onClick={() => go(addDays(today, -1))} aria-label="Previous day">
        ‹
      </button>
      <input
        type="date"
        value={today}
        aria-label="Pretend today's date"
        onChange={(e) => go(e.target.value || null)}
      />
      <button type="button" onClick={() => go(addDays(today, 1))} aria-label="Next day">
        ›
      </button>
      {/* Only when there is something to go back to, so the usual state of this
          bar is a date and two arrows rather than a permanent undo. */}
      {override && override !== real && (
        <button type="button" onClick={() => go(null)}>
          Today
        </button>
      )}
    </div>
  );
}
