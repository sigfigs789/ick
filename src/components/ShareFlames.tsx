import type { CSSProperties } from "react";
import { flameLevel, type FlameTier } from "../game/shareFlamesTest";

interface Props {
  tier: FlameTier;
}

/**
 * The flames a Share button burns with in the share flames test (see
 * game/shareFlamesTest.ts): tongues in the tier's colour, rising from behind
 * the label and flickering. Each tier up adds a tongue and burns taller, from
 * three small ones at Extremely Rare to six tall ones at Legend. The middle
 * tongues stand tallest, so the fire peaks over the label.
 *
 * Drawn inside the button, which sets `.share-flames-host` so the tongues sit
 * between its fill and its label; decoration only, so hidden from readers.
 */
export function ShareFlames({ tier }: Props) {
  const level = flameLevel(tier);
  const count = level + 2;
  const slug = tier.toLowerCase().replace(" ", "-");
  return (
    <span
      className={`share-flames share-flames--${level} share-flames--${slug}`}
      style={{ "--n": count } as CSSProperties}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => {
        // 0 at either end, 1 in the middle.
        const centre = 1 - Math.abs(i - (count - 1) / 2) / ((count - 1) / 2);
        const style = { "--i": i, "--tall": (0.65 + 0.35 * centre).toFixed(2) } as CSSProperties;
        return <span key={i} className="share-flames__tongue" style={style} />;
      })}
    </span>
  );
}
