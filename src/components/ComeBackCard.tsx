import { useEffect, useState } from "react";
import {
  formatCountdown,
  googleCalendarUrl,
  loadReminderAdded,
  msUntilNextDrop,
  reminderIcs,
  saveReminderAdded,
  streakGoal,
} from "../game/comeBack";
import { trackReminderAdded } from "../analytics";
import type { StreakState } from "../game/types";

interface Props {
  /** Today's date, which the reminder starts the day after. */
  date: string;
  streak: StreakState;
  /**
   * Offer the calendar reminder. Off inside a Reddit post, where the frame
   * blocks downloads and the post itself is how players come back.
   */
  offerReminder?: boolean;
}

/** Often enough that the minutes never visibly lag; the label only shows minutes. */
const TICK_MS = 15_000;

/**
 * Under today's banked word: when the next drop lands, what playing it does
 * for the streak, and a daily reminder to put in a calendar (see
 * game/comeBack.ts for why each is here).
 */
export function ComeBackCard({ date, streak, offerReminder = true }: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const [added, setAdded] = useState(loadReminderAdded);
  const [choosing, setChoosing] = useState(false);
  const goal = streakGoal(streak);

  function markAdded(via: "ics" | "google") {
    saveReminderAdded();
    setAdded(true);
    setChoosing(false);
    trackReminderAdded(via);
  }

  function downloadIcs() {
    const blob = new Blob([reminderIcs(new Date(), date)], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "wordink-daily.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    markAdded("ics");
  }

  return (
    <section className="come-back" aria-label="Tomorrow's drop">
      <p className="come-back__countdown">
        Next drop in <strong>{formatCountdown(msUntilNextDrop(now))}</strong>
      </p>
      <p className="come-back__goal">
        <span aria-hidden="true">🔥 </span>
        {goal.headline}
      </p>
      {goal.detail && <p className="come-back__detail">{goal.detail}</p>}
      {offerReminder &&
        (added ? (
          <p className="come-back__added">
            <span aria-hidden="true">📅 </span>Daily reminder added
          </p>
        ) : choosing ? (
          <div className="come-back__reminder-options">
            <button type="button" className="come-back__reminder" onClick={downloadIcs}>
              Apple / Outlook
            </button>
            <a
              className="come-back__reminder"
              href={googleCalendarUrl(new Date(), date)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => markAdded("google")}
            >
              Google Calendar
            </a>
          </div>
        ) : (
          <button type="button" className="come-back__reminder" onClick={() => setChoosing(true)}>
            <span aria-hidden="true">📅 </span>Remind me daily
          </button>
        ))}
    </section>
  );
}
