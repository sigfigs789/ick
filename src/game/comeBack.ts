/**
 * The reasons to come back tomorrow, said at the moment a player is most
 * likely to leave: once today's word is banked.
 *
 * Nothing on a played puzzle used to look forward. The streak sat there as a
 * number, the freezes as a badge, and the only clue that there would be
 * another drop at all was the calendar. So a first-day player finished, shared
 * or didn't, and had no prompt to return -- which is what D1 measures. Three
 * things here answer it:
 *
 * - when the next drop lands (`msUntilNextDrop`), a countdown to the player's
 *   own local midnight, which is when `todayDateString` rolls over;
 * - what playing tomorrow is worth to the streak (`streakGoal`): the next
 *   count, a freeze it earns, or the best streak it is closing in on;
 * - a daily reminder the player can put in their own calendar
 *   (`reminderIcs`, `googleCalendarUrl`), because the site has no push and a
 *   calendar alarm is the one nudge a web page can leave behind.
 */

import { addDays } from "./date";
import { freezeCap } from "./streakFreeze";
import type { StreakState } from "./types";

/** Milliseconds from `now` until the next local midnight, when the next drop opens. */
export function msUntilNextDrop(now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(0, midnight.getTime() - now.getTime());
}

/** "5h 12m", "12m", or "under a minute": coarse on purpose, so it ticks quietly. */
export function formatCountdown(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

/** Whether a streak reaching `days` played days earns a saved freeze (see streakFreeze.earnFreeze). */
function earnsFreezeOn(days: number): boolean {
  return days === 3 || (days > 0 && days % 7 === 0);
}

export interface StreakGoal {
  /** What playing tomorrow does: always said. */
  headline: string;
  /** The next milestone past tomorrow, when there is one worth naming. */
  detail?: string;
}

/**
 * What tomorrow is worth, for a streak that has already been played today.
 *
 * The detail names the nearest thing a player can actually get: a freeze
 * tomorrow, else the next freeze that would fit under the cap, else the best
 * streak they have run. A freeze past the cap is not kept, so it is not
 * promised.
 */
export function streakGoal(streak: StreakState): StreakGoal {
  const days = streak.currentStreak;
  const next = days + 1;
  const best = Math.max(streak.longestStreak, days);
  const banked = streak.bankedFreezes ?? 0;
  const keeps = (on: number) => earnsFreezeOn(on) && banked < freezeCap(Math.max(best, on));

  const headline =
    days <= 1
      ? "Play tomorrow to start a streak."
      : `Play tomorrow to make it a ${next}-day streak.`;

  if (keeps(next)) {
    return { headline, detail: "Tomorrow earns a 🧊 freeze, which saves your streak on a day you miss." };
  }
  // A full cap only rises at 14 and 28 days, so four weeks out is as far as a
  // kept freeze can be.
  for (let freezeDay = next + 1; freezeDay <= next + 28; freezeDay++) {
    if (keeps(freezeDay)) {
      return { headline, detail: `${freezeDay - days} days to your next 🧊 streak freeze.` };
    }
  }
  if (best > days) {
    const away = best - days + 1;
    return { headline, detail: `${away} days to beat your best streak of ${best}.` };
  }
  if (days >= 2) return { headline, detail: "This is your longest streak yet." };
  return { headline };
}

/** Where a reminder sends the player: `s=rem` so a return through it is counted as one (see game/visits.ts). */
export const REMINDER_URL = "https://wordink.app/?s=rem";

const REMINDER_TITLE = "WordInk: today's drop is out";
const REMINDER_DETAILS = `Find the rarest word with today's letters. ${REMINDER_URL}`;

/**
 * The reminder's daily start: tomorrow, at the half hour the player is playing
 * now. Whatever time they found for it today is the likeliest to fit again.
 * Floating local time ("20261024T093000", no zone), so the calendar keeps it
 * at that hour on the player's clock through DST and travel.
 */
export function reminderStart(now: Date, today: string): string {
  const date = addDays(today, 1).replace(/-/g, "");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = now.getMinutes() < 30 ? "00" : "30";
  return `${date}T${hh}${mm}00`;
}

function utcStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escape text for an iCalendar TEXT value (RFC 5545 §3.3.11). */
function icsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * A daily, repeating, five-minute event with an alarm at its start, as an
 * .ics file: Apple Calendar, Outlook and most Android calendars open it to an
 * "Add" prompt. Marked free, so it never shows the player as busy.
 */
export function reminderIcs(now: Date, today: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WordInk//Daily reminder//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:wordink-daily-${utcStamp(now)}@wordink.app`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${reminderStart(now, today)}`,
    "DURATION:PT5M",
    "RRULE:FREQ=DAILY",
    `SUMMARY:${icsText(REMINDER_TITLE)}`,
    `DESCRIPTION:${icsText(REMINDER_DETAILS)}`,
    `URL:${REMINDER_URL}`,
    "TRANSP:TRANSPARENT",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(REMINDER_TITLE)}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** The same reminder as a Google Calendar "add event" link, for players whose calendar is Google's. */
export function googleCalendarUrl(now: Date, today: string): string {
  const start = reminderStart(now, today);
  const [date, time] = start.split("T");
  const endMinutes = Number(time.slice(2, 4)) + 5;
  const end = `${date}T${time.slice(0, 2)}${String(endMinutes).padStart(2, "0")}00`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: REMINDER_TITLE,
    details: REMINDER_DETAILS,
    dates: `${start}/${end}`,
    recur: "RRULE:FREQ=DAILY",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const REMINDER_KEY = "ick:reminder";

/** Whether this browser has added the daily reminder, so the card can stop asking. */
export function loadReminderAdded(): boolean {
  try {
    return localStorage.getItem(REMINDER_KEY) === "added";
  } catch {
    return false;
  }
}

export function saveReminderAdded(): void {
  try {
    localStorage.setItem(REMINDER_KEY, "added");
  } catch {
    // Not remembered: the card offers the reminder again next time, which is harmless.
  }
}
