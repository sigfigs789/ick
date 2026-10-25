import { moveRange } from "../components/analyticsFormat";
import { samePreset, spanOf, type Choice, type Preset } from "./window";

/**
 * The window picker on /analyticsV2 and /experimentsV2: a button for each
 * preset, then From and to dates for any range. Picking a date makes the
 * window a range; with no range picked the dates show the preset's own days,
 * or stay blank for one that covers everything. `counting` says the page is
 * still showing the last window's numbers while the new one loads.
 */
export function WindowPicker({
  choice,
  presets,
  today,
  counting,
  onChoose,
}: {
  choice: Choice;
  presets: readonly Preset[];
  today: string;
  counting: boolean;
  onChoose: (next: Choice) => void;
}) {
  const shown = spanOf(choice, today);
  return (
    <div className="analytics__window" role="group" aria-label="Time window">
      <span className="analytics__window-row">
        <span className="analytics__window-label">Window</span>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className="analytics__window-button"
            aria-pressed={samePreset(choice, p.choice)}
            onClick={() => onChoose(p.choice)}
          >
            {p.label}
          </button>
        ))}
      </span>
      <span className="analytics__window-row analytics__window-dates">
        {(["from", "to"] as const).map((end) => (
          <label key={end}>
            <span className="analytics__window-label">{end === "from" ? "From" : "to"}</span>
            <input
              type="date"
              className="analytics__window-date"
              value={shown?.[end] ?? ""}
              max={today}
              data-active={choice.kind === "range"}
              onChange={(e) => {
                const value = e.target.value > today ? today : e.target.value;
                if (!value) return;
                // From everything, a From date runs to today and a to date is one day.
                onChoose({ kind: "range", ...moveRange(shown ?? { from: value, to: today }, end, value) });
              }}
            />
          </label>
        ))}
        <span className="review__meta" role="status">
          {counting ? "Counting…" : ""}
        </span>
      </span>
    </div>
  );
}
