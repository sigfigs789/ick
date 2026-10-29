import { useEffect, useState } from "react";
import { ConfettiBurst } from "./ConfettiBurst";
import { celebrationShareLine, type EarnedAchievement } from "../game/achievements";

/** How long the card stays up if nobody closes it, as the other cards do. */
const CELEBRATION_MS = 7000;
/** The most badges the card names; the rest are left to the Stats page. */
const MOST_SHOWN = 3;

/**
 * The moment a word earns an achievement (see game/achievements.ts) -- until
 * now a badge turned up on the Stats page with nobody having said a word.
 *
 * The improving average's card, in ink violet, with the badge itself as the
 * centrepiece and gold confetti falling around it. It floats over the puzzle
 * and goes by itself or on a tap of its ×. A word that earns several at once
 * (a first word that is also a Legend) lists them all on the one card.
 *
 * The same card welcomes a returning player's badges that were never announced
 * (see `achievementsToCatchUp`): `total` is how many there are, of which
 * `achievements` is the few worth naming, and the rest are left to the Stats
 * page. No card names more than three, however many a word earns.
 *
 * A lone badge one word earned names that word.
 *
 * A lone badge also says how many players hold it, or that this player is the
 * first -- read as the card opens, so this player's own report, landing a
 * moment later, never changes it.
 */
export function AchievementCelebration({
  achievements: earned,
  total: given = earned.length,
  onDone,
}: {
  achievements: readonly EarnedAchievement[];
  total?: number;
  onDone: () => void;
}) {
  const achievements = earned.slice(0, MOST_SHOWN);
  const total = Math.max(given, earned.length);
  const [share] = useState(() =>
    achievements.length === 1 && total === 1 ? celebrationShareLine(achievements[0].id) : null
  );
  useEffect(() => {
    const timeout = window.setTimeout(onDone, CELEBRATION_MS);
    return () => window.clearTimeout(timeout);
  }, [onDone]);

  if (achievements.length === 0) return null;
  const [only] = achievements;
  const several = achievements.length > 1;
  const more = total - achievements.length;
  return (
    <>
      <ConfettiBurst grand />
      <div className="improvement improvement--achievement" role="status">
        <div className="improvement__card">
          <button type="button" className="improvement__close" onClick={onDone} title="Dismiss" aria-label="Dismiss">
            ×
          </button>
          <span className="achievement-unlocked__eyebrow">
            {total > 1 ? `${total} achievements unlocked` : "Achievement unlocked"}
          </span>
          {several ? (
            <span className="achievement-unlocked__list">
              {achievements.map((achievement) => (
                <span className="achievement-unlocked__item" key={achievement.id}>
                  <span className="achievement-unlocked__item-icon" aria-hidden="true">
                    {achievement.icon}
                  </span>
                  <span className="achievement-unlocked__item-title">{achievement.title}</span>
                </span>
              ))}
            </span>
          ) : (
            <>
              <span className="achievement-unlocked__medal" aria-hidden="true">
                <span className="achievement-unlocked__rays" />
                <span className="achievement-unlocked__badge">{only.icon}</span>
              </span>
              <span className="improvement__title">{only.title}</span>
              <span className="improvement__body">{only.description}</span>
              {only.word && (
                <span className="achievement-unlocked__word">
                  With <strong>{only.word}</strong>
                </span>
              )}
              {share && <span className="achievement-unlocked__share">{share}</span>}
            </>
          )}
          <span className="achievement-unlocked__footnote">
            {more > 0
              ? `And ${more} more. See them all on your Stats page.`
              : several
                ? "They're on your Stats page."
                : "It's on your Stats page."}
          </span>
        </div>
      </div>
    </>
  );
}
