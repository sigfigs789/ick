import { loadPlayerId } from "./game/player";
import { visitorTag } from "./game/visitor";

/** The scalar property values /api/events accepts. */
export type EventProps = Record<string, string | number | boolean | null>;

/**
 * Write one event to the game's own Supabase table through /api/events.
 *
 * Fire-and-forget by construction: `sendBeacon` hands the request to the browser,
 * which delivers it on its own time and even after the page goes away, and there
 * is no response to read. Nothing about the game waits on this or changes if it
 * fails -- the dictionary the game plays against is the shipped one, and this
 * endpoint is write-only.
 *
 * Skipped under test, where there is no server to post to and a stray request
 * would be noise. `npm run dev` does serve /api/events (see vite.config.ts), so
 * the path is exercisable locally.
 *
 * Every row carries `player_id`, the board identity (see game/player.ts), so
 * the log can be read per player rather than only per event: which mode a player
 * settles on, whether a switch sticks, whether they come back the next day. None
 * of that is a count of events. Added here rather than at each call so no event
 * can be written without it. Null for a browser that has no id yet or cannot
 * store one.
 *
 * Whether to report at all is the caller's decision (see `send` in
 * analytics.ts): inside a Reddit post the id is the player's account name and
 * must never leave the host.
 */
export function logEvent(name: string, props?: EventProps): void {
  if (import.meta.env.MODE === "test") return;
  try {
    // A known visitor's tag (see game/visitor.ts) rides on every row for the
    // same reason the id does, and only when there is one: the report sets
    // those browsers apart from the players.
    const visitor = visitorTag();
    const body = JSON.stringify({
      name,
      props: {
        ...props,
        player_id: loadPlayerId(),
        ...(visitor ? { visitor } : {}),
      },
    });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
    // Older Safari has no sendBeacon; `keepalive` gets the same survive-unload
    // behaviour out of fetch.
    void fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Recording an event must never be able to break the move that produced it.
  }
}
