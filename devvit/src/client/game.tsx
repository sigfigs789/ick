// WordInk, rendered inside the Reddit post's expanded webview.
//
// The puzzle is the player's own day, exactly as it is on the website: the game
// reads the date off the device and nothing here overrides it. A post is a
// doorway to the game rather than a container for one puzzle, so an old post
// opens today's just as the current one does.
//
// The game is the same React tree the website runs; it is imported from the
// repo's own `src/` rather than copied, so the two front-ends cannot drift.
// What differs is everything around it, and this file is where that difference
// is applied -- once, before the first render.
import '../../../src/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from '../../../src/Root';
import { setInMemoryRouting } from '../../../src/routes';
import { setReporting } from '../../../src/analytics';
import { setAccount } from '../../../src/game/player';

/**
 * Play as the Reddit account, not as the browser.
 *
 * Must land before the first render: `Root` mints a board identity during
 * render, and a client that had already invented a UUID by the time the
 * username arrived would keep it -- naming the player something they are not
 * and never matching their own row on the board.
 *
 * A failure leaves the browser's own identity in place, which is the website's
 * behaviour and a working game.
 */
try {
  const response = await fetch('/api/init');
  if (response.ok) {
    const body = (await response.json()) as { username?: unknown };
    if (typeof body.username === 'string' && body.username) setAccount(body.username);
  }
} catch {
  // A player with no account plays as this browser, exactly as on the website.
}

// Route in memory rather than off the address bar. The frame's URL is one the
// player never sees and cannot link to, and a reload would ask the static
// server for `/leaderboard`, which has no rewrite in front of it. The header's
// tabs are the navigation, which is all a player inside a post has anyway.
setInMemoryRouting(true);

// Report nothing. Vercel's scripts are blocked by the frame's content policy
// and `/api/events` is a path this build does not serve, so every event would
// be a blocked script and a request into nothing -- and reporting what Reddit's
// players do to a third party is the one thing this build is careful not to do
// anywhere else.
setReporting(false);

// `Root` rather than `App`: the puzzle is one of five pages, and the other four
// -- the header, the boards, the finds -- are the rest of the game. Rendering
// the puzzle alone left everything the server does for the leaderboard with no
// way to be seen.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
