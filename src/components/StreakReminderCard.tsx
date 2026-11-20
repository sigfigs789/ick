import { useState } from "react";

interface Props {
  onEnable: () => Promise<boolean>;
  onDismiss: () => void;
}

/**
 * The card offering a streak reminder, shown once a player has played three
 * days (see game/streakReminder.ts). "Remind me" is what opens the browser's
 * permission prompt, so it is only ever shown after the player chose it.
 */
export function StreakReminderCard({ onEnable, onDismiss }: Props) {
  const [state, setState] = useState<"idle" | "asking" | "failed">("idle");
  const enable = async () => {
    setState("asking");
    if (await onEnable()) onDismiss();
    else setState("failed");
  };
  return (
    <div className="welcome-back-card" role="status">
      <div className="welcome-back-card__copy">
        <p className="welcome-back-card__title">
          <span aria-hidden="true">🔥</span> Keep your streak?
        </p>
        <p className="welcome-back-card__line">
          {state === "failed"
            ? "Couldn't turn reminders on. Check this site's notification setting."
            : "Get a reminder at 11:30 am on days your streak is about to end."}
        </p>
        {state !== "failed" && (
          <button type="button" disabled={state === "asking"} onClick={enable}>
            Remind me
          </button>
        )}
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
