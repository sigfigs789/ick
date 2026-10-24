import { trackModeChanged } from "../analytics";
import { MODE_LABELS, otherMode, type GameMode } from "../game/mode";
import { RainbowWord } from "./RainbowWord";

/**
 * The switch between Standard and Freeform, in the header.
 *
 * What used to be the "Freeform" button, which opened a notice about a week
 * everybody was in whether they liked it or not. The week is over and the rules
 * it trialled are staying, as a choice -- so the button that announced it becomes
 * the control that makes it, in the same place, at the same size.
 *
 * One button rather than a segmented pair. A phone header has room for a word
 * and a "?", and a two-cell control at that width either wraps or shrinks its
 * labels to the point where neither reads. So the button says where you *are*,
 * which is the thing a player needs at a glance, and pressing it goes to the
 * other one -- with the destination in the accessible name, which is where a
 * screen reader needs it. `aria-pressed` would be a lie here: this is not a
 * feature being turned on, it is two games and you are in one of them.
 */
export function ModeToggle({
  mode,
  onChange,
}: {
  mode: GameMode;
  onChange: (mode: GameMode) => void;
}) {
  const next = otherMode(mode);
  return (
    <button
      type="button"
      className={`app__mode-button app__mode-button--${mode}`}
      onClick={() => {
        // Reported from here rather than from the setter: this is the one place
        // a *player* changes modes, and a mode restored from storage on load is
        // not a decision anybody made today.
        trackModeChanged(mode, next);
        onChange(next);
      }}
      aria-label={`Mode: ${MODE_LABELS[mode]}. Switch to ${MODE_LABELS[next]}.`}
    >
      {/* Freeform's name in the same rainbow its share preview uses, so the
          game announces itself in one colour language everywhere it is named.
          The button's accessible name above is what a screen reader reads, so
          the letters are never spelled out one at a time. */}
      {mode === "freeform" ? <RainbowWord word={MODE_LABELS[mode]} /> : MODE_LABELS[mode]}
      {/* Decoration. The button's accessible name above already says both the
          mode and where pressing goes, so the arrows are not announced again. */}
      <span className="app__mode-swap" aria-hidden="true">
        ⇄
      </span>
    </button>
  );
}

/**
 * Both modes side by side, the current one filled: the switch as it sits in
 * the header's "?" menu, where there is room for the pair the bar never had.
 * A radio group, because it is one choice of two, and picking the mode you
 * are already in does nothing.
 */
export function ModeSegments({
  mode,
  onChange,
}: {
  mode: GameMode;
  onChange: (mode: GameMode) => void;
}) {
  const modes: GameMode[] = ["standard", "freeform"];
  return (
    <div className="mode-segments" role="radiogroup" aria-label="Mode">
      {modes.map((option) => {
        const current = option === mode;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={current}
            className={`mode-segments__option${current ? " mode-segments__option--current" : ""}`}
            onClick={() => {
              if (current) return;
              trackModeChanged(mode, option);
              onChange(option);
            }}
          >
            {MODE_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
