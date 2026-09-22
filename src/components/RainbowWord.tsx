import { Fragment } from "react";

/**
 * One word with a hue per letter, for the "Freeform" that stands where the week
 * and month totals go on a Freeform result (see game/share.ts).
 *
 * A small piece of delight in the one place it costs nothing: the share preview
 * is already the screen a player looks at rather than reads, and the word is
 * there to say "this one is the other game" -- which a colour says faster than
 * the letters do.
 *
 * In the preview only. The text that actually leaves the app is plain text
 * going into a clipboard, an X post or a message, and plain text has no colour
 * to give -- so the word is the same word either way and only this rendering of
 * it is painted. Nothing about the share's content depends on it.
 *
 * Every letter is announced as itself because the word is inside an
 * `aria-hidden` preview (see ResultsPanel): the spans are a paint over text the
 * screen reader was never being offered. If that preview is ever exposed, this
 * needs a wrapper carrying the whole word as its accessible name -- a screen
 * reader must not be handed "F, r, e, e..." one letter at a time.
 */

/**
 * The hues, evenly spaced around the wheel and starting at red.
 *
 * Spread across the word rather than fixed per position, so a longer or shorter
 * word still travels the whole spectrum instead of stopping partway through it.
 */
const HUE_SWEEP = 300;

/**
 * Colours picked for legibility first, which is what keeps this from being a
 * novelty that costs the line its readability: a fixed saturation and lightness
 * with only the hue moving, tuned in index.css to clear contrast against the
 * preview's own background in both themes.
 *
 * Yellow and cyan are the two that would fail at a lightness the rest look right
 * at, so the sweep stops at 300 degrees -- red through magenta, skipping the
 * stretch of the wheel that cannot be read on a light background.
 */
export function RainbowWord({ word }: { word: string }) {
  const letters = [...word];
  return (
    <span className="rainbow-word">
      {letters.map((letter, index) => (
        <Fragment key={index}>
          <span
            className="rainbow-word__letter"
            style={{
              // Divided by the gaps between letters rather than by the count, so
              // the first letter sits at 0 and the last at the far end of the
              // sweep. A one-letter word has no gaps and simply starts at red.
              ["--rainbow-hue" as string]:
                letters.length > 1 ? (index * HUE_SWEEP) / (letters.length - 1) : 0,
            }}
          >
            {letter}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
