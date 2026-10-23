import type { WelcomeBack } from "../game/streakFreeze";

interface Props {
  welcome: WelcomeBack;
  onDismiss: () => void;
}

/**
 * The card over the input for a player back after their streak ended (see
 * `welcomeBack` in game/streakFreeze.ts). The streak strip below reads 0 for
 * them, so this says what they had and what starting again brings: a saved
 * freeze on today's first word, when one is due. Gone once a word is played,
 * when the freeze badge shows the freeze itself.
 */
export function WelcomeBackCard({ welcome, onDismiss }: Props) {
  return (
    <div className="welcome-back-card" role="status">
      <div className="welcome-back-card__copy">
        <p className="welcome-back-card__title">
          <span aria-hidden="true">👋</span> Welcome back!
        </p>
        <p className="welcome-back-card__line">
          Your best streak was <strong>{welcome.best} days</strong>.{" "}
          {welcome.freeze ? (
            <>
              Play today to start a new one, and get a free <span aria-hidden="true">🧊</span>{" "}
              streak freeze to cover a missed day.
            </>
          ) : (
            "Play today to start a new one."
          )}
        </p>
      </div>
      <button
        type="button"
        className="welcome-back-card__close"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
