import type { CSSProperties } from "react";

/**
 * The tongues along the top edge, one per entry, spread across the button's
 * whole width whatever it is: each one's share of the tier's flame height, a
 * ragged pattern rather than a smooth one so the edge reads as fire, not a
 * crown.
 */
const HEIGHTS = [
  0.5, 0.8, 0.6, 0.95, 0.7, 1, 0.65, 0.85, 0.55, 0.9, 1, 0.7, 0.95, 0.6, 0.85, 1, 0.65, 0.9, 0.6, 0.8, 0.5,
];

/**
 * The flames along a burning Share button's top edge: a row of tongues across
 * its whole width, in the tier's colour, flickering on staggered timings. They
 * burn taller each tier up, from a low lick at Elusive to a blaze at
 * Legend. The button sets `shareFlamesClass` (see game/shareFlames.ts),
 * which carries the tier: its fill, colours and flame height.
 *
 * Decoration only, so hidden from readers.
 */
export function ShareFlames() {
  return (
    <span className="share-flames" aria-hidden="true">
      {HEIGHTS.map((tall, i) => {
        const style = { "--i": i, "--x": i / (HEIGHTS.length - 1), "--tall": tall } as CSSProperties;
        return <span key={i} className="share-flames__tongue" style={style} />;
      })}
    </span>
  );
}
