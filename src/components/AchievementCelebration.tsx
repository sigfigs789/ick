import { ConfettiBurst } from "./ConfettiBurst";
import type { Achievement } from "../game/achievements";

/**
 * The moment a word earns an achievement (see game/achievements.ts) -- until
 * now a badge turned up on the Stats page with nobody having said a word.
 *
 * The improving average's card, in ink violet, with the badge itself as the
 * centrepiece and gold confetti falling around it. It floats over the puzzle
 * and stays until the player taps it away. A word that earns several at once
 * (a first word that is also a Legend) lists them all on the one card.
 *
 * The same card welcomes a returning player's badges that were never announced
 * (see `achievementsToCatchUp`): `total` is how many there are, of which
 * `achievements` is the few worth naming, and the rest are left to the Stats
 * page.
 */
export function AchievementCelebration({
  achievements,
  total = achievements.length,
  onDone,
}: {
  achievements: readonly Achievement[];
  total?: number;
  onDone: () => void;
}) {
  if (achievements.length === 0) return null;
  const [only] = achievements;
  const several = achievements.length > 1;
  const more = total - achievements.length;
  return (
    <>
      <ConfettiBurst grand />
      <div className="improvement improvement--achievement" role="status">
        <button type="button" className="improvement__card" onClick={onDone} title="Dismiss">
          <span className="improvement__close" aria-hidden="true">
            ×
          </span>
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
            </>
          )}
          <span className="achievement-unlocked__footnote">
            {more > 0
              ? `And ${more} more. See them all on your Stats page.`
              : several
                ? "They're on your Stats page."
                : "It's on your Stats page."}
          </span>
        </button>
      </div>
    </>
  );
}
