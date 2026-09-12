import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

interface Handlers {
  /** The app came back to the foreground. */
  onForeground?: () => void;
  /** The app went to the background, or was covered by something. */
  onBackground?: () => void;
}

/**
 * The app coming and going, as the two events the game actually cares about.
 *
 * The website watches `visibilitychange` and `pageshow`; this is the same
 * question asked of a phone. Two details make it worth a hook rather than an
 * inline listener:
 *
 *   - The callbacks are held in a ref, so a caller passing a fresh closure on
 *     every render does not tear down and rebuild the subscription each time.
 *   - `inactive` is not a background. iOS sends it for the app switcher, a
 *     notification shade, and an incoming call banner -- moments the player is
 *     still very much in the app. Only `background` counts, or a glance at the
 *     notification centre would end the session and a dismissal would start a
 *     new one.
 */
export function useAppState({ onForeground, onBackground }: Handlers): void {
  const handlers = useRef<Handlers>({ onForeground, onBackground });

  // Refreshed in an effect rather than assigned during render: writing to a ref
  // while rendering is a side effect in a function that is allowed to be run
  // twice and thrown away. The subscription below cannot fire before this has
  // run at least once, so there is no window where it reads a stale callback.
  useEffect(() => {
    handlers.current = { onForeground, onBackground };
  }, [onForeground, onBackground]);

  useEffect(() => {
    let previous = AppState.currentState;

    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const wasActive = previous === 'active';
      previous = next;

      if (next === 'active' && !wasActive) handlers.current.onForeground?.();
      else if (next === 'background' && wasActive) handlers.current.onBackground?.();
    });

    return () => subscription.remove();
  }, []);
}
