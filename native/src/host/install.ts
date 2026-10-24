import { setReporting } from '../../../src/analytics';
import { installLocalStorage, installSessionStorage } from './storage';
import { installFetchBaseUrl } from './net';
import { installWindowEvents } from './events';

/**
 * Every difference between this host and the website, applied in one place,
 * before the first render.
 *
 * The Reddit build has a file shaped exactly like this one
 * (`devvit/src/client/game.tsx`), and for the same reason: the game is shared
 * code, so the way to run it somewhere new is to state what is different about
 * the somewhere, once, rather than to fork it.
 *
 * Ordering matters and is not incidental -- the game reads storage during
 * render (`Root` mints a player id, `useDailyPuzzle` seeds its state), so both
 * shims have to be in place before React is handed a tree, which is why this
 * is called at module scope from `index.ts` rather than from an effect.
 */
export function installHost(): void {
  // Synchronous key-value storage, which is what the game's persistence layer
  // is written against and what a device does not have. Both halves of the Web
  // Storage API: the game reaches for `sessionStorage` on the first guess, and
  // a missing global is a thrown ReferenceError here rather than `undefined`.
  installLocalStorage();
  installSessionStorage();

  // `/api/...` resolved against the site, since there is no page for a
  // root-relative path to be relative to.
  installFetchBaseUrl();

  // `window.dispatchEvent`, which the game calls on every save so the header
  // can learn a first puzzle was played (see PROGRESS_SAVED_EVENT in
  // src/game/storage.ts). A missing one would throw mid-save.
  installWindowEvents();

  // The idle hint for everyone. On the website it is a 50/50 test, drawn only
  // where events are reported -- which this build never does, so without a
  // pin no player here would see it. Same call as the Reddit build. Required
  // here rather than imported: the module pulls in the dictionary, which must
  // not load before the storage shims above.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pinIdleHintVariant } = require('../../../src/game/idleHint') as typeof import('../../../src/game/idleHint');
  pinIdleHintVariant('treatment');

  /*
   * Report nothing.
   *
   * Vercel Analytics is a browser script with no meaning here, and its import
   * is stubbed out at the bundler (see metro.config.js) -- but the more
   * important half is the Supabase mirror behind it, which `send` would still
   * reach. Both stop at this flag.
   *
   * This is the same call the Reddit build makes, and the reason is stronger
   * here, not weaker: an app store build has to say in its privacy declaration
   * exactly what it collects and where it goes, and "nothing, nowhere" is a
   * claim worth being able to make truthfully. What the app does send is the
   * player's own score to the game's leaderboard, which is the feature and is
   * described as such -- see README.md.
   */
  setReporting(false);
}
