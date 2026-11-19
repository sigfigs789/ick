/**
 * Streak reminders: a web push, around 23:30 local time, on the day a player's
 * streak ends if they have not played.
 *
 * Offered once a player has played REMIND_AFTER_PLAYED days, never before: a
 * permission prompt on a first visit is how a site gets blocked. The card asks
 * (components/StreakReminderCard.tsx); the browser's own prompt follows only
 * when it is pressed.
 *
 * The game works out the date the streak would end (`reminderRiskDate`) and
 * sends it to /api/reminders after every play, so the server needs none of the
 * streak rules. Playing moves the date out a day; a saved freeze or an earned
 * rest day takes it away. scripts/send-streak-reminders.mjs does the sending.
 *
 * Off unless VITE_VAPID_PUBLIC_KEY is set, so a build without the keys never
 * shows the card.
 */

import { addDays } from "./date";
import { loadPlayerId } from "./player";
import { isRestDay } from "./streakFreeze";
import type { StreakState } from "./types";

/** Days played before the card is shown: the 3rd day. */
export const REMIND_AFTER_PLAYED = 3;

const DISMISSED_KEY = "ick:streak-reminder-dismissed";

/**
 * The local date this streak ends if it goes unplayed, or null when nothing
 * can end it. Tomorrow once today is played, today before. Null for no streak,
 * a saved freeze to spend, or a rest day.
 */
export function reminderRiskDate(streak: StreakState, today: string): string | null {
  if (streak.currentStreak <= 0) return null;
  const date = streak.lastCompletedDate === today ? addDays(today, 1) : today;
  if (isRestDay(streak, date)) return null;
  if ((streak.bankedFreezes ?? 0) > 0) return null;
  return date;
}

export interface ReminderContext {
  playedDays: number;
  playedToday: boolean;
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  dismissed: boolean;
}

/** Whether to show the card: 3 days played, today one of them, nothing asked yet. */
export function shouldOfferReminders(context: ReminderContext): boolean {
  return (
    context.supported &&
    context.permission === "default" &&
    !context.dismissed &&
    context.playedToday &&
    context.playedDays >= REMIND_AFTER_PLAYED
  );
}

function vapidKey(): string {
  return (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? "";
}

export function remindersSupported(): boolean {
  return (
    Boolean(vapidKey()) &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function reminderPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export function reminderDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissReminderCard(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Closed for this session (component state).
  }
}

function keyBytes(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function send(method: "POST" | "DELETE", body: unknown): Promise<boolean> {
  try {
    const response = await fetch("/api/reminders", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Ask the browser for permission and subscribe. Resolves false when the player
 * says no or anything fails: reminders are an extra and never get in the way.
 */
export async function enableReminders(streak: StreakState, today: string): Promise<boolean> {
  if (!remindersSupported()) return false;
  try {
    if ((await Notification.requestPermission()) !== "granted") return false;
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(vapidKey()),
      }));
    return await postSubscription(subscription, reminderRiskDate(streak, today));
  } catch {
    return false;
  }
}

function postSubscription(subscription: PushSubscription, riskDate: string | null): Promise<boolean> {
  return send("POST", {
    endpoint: subscription.endpoint,
    playerId: loadPlayerId(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    riskDate,
  });
}

/**
 * Tell the server the streak's current end date, for a player who already
 * subscribed. Quiet when they have not, or have since blocked notifications.
 */
export async function syncReminder(riskDate: string | null): Promise<void> {
  if (!remindersSupported() || reminderPermission() !== "granted") return;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) await postSubscription(subscription, riskDate);
  } catch {
    // Retried on the next play.
  }
}
