/**
 * The slice of the DOM's event API the shared game code uses on `window`:
 * `addEventListener`, `removeEventListener` and `dispatchEvent`, plus an
 * `Event` constructor to dispatch.
 *
 * React Native's `window` is the global object and has none of them, so a
 * `window.dispatchEvent(new Event(...))` in shared code -- the game announces
 * every save that way -- would throw. Listeners are keyed by type and called
 * synchronously, which is all the game asks of them. Anything already present
 * is left alone.
 */
type Listener = (event: { type: string }) => void;

export function installWindowEvents(): void {
  const target = globalThis as unknown as Record<string, unknown>;

  if (typeof target.Event !== 'function') {
    target.Event = class Event {
      readonly type: string;
      constructor(type: string) {
        this.type = type;
      }
    };
  }

  if (typeof target.dispatchEvent === 'function') return;

  const listeners = new Map<string, Set<Listener>>();
  target.addEventListener = (type: string, listener: Listener) => {
    let set = listeners.get(type);
    if (!set) listeners.set(type, (set = new Set()));
    set.add(listener);
  };
  target.removeEventListener = (type: string, listener: Listener) => {
    listeners.get(type)?.delete(listener);
  };
  target.dispatchEvent = (event: { type: string }) => {
    for (const listener of [...(listeners.get(event.type) ?? [])]) {
      try {
        listener(event);
      } catch {
        // One listener's failure is not the dispatcher's: the save that
        // announced itself has already happened.
      }
    }
    return true;
  };
}
