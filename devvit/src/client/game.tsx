// WordInk, rendered inside the Reddit post's expanded webview.
//
// The game is the same React tree the website runs; it is imported from the
// repo's own `src/` rather than copied, so the two front-ends cannot drift.
// What differs is everything around it, and this file is where that difference
// is applied -- once, before the first render.
import '../../../src/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from '../../../src/Root';
import { setPuzzleDay } from '../../../src/game/date';
import { setInMemoryRouting } from '../../../src/routes';

/**
 * Ask the post which puzzle it is, then draw it.
 *
 * The day has to be fixed *before* the tree mounts. The game reads it during
 * render -- to pick the drop, to key the day's progress, to bracket the board's
 * windows -- and a value that arrived afterwards would reach none of those; the
 * player would get a frame of the wrong puzzle, and whatever they did in it
 * would be saved under the wrong day.
 *
 * A failure here is not fatal and must not be. If the post records no puzzle,
 * or the request fails, the day falls back to the player's own clock, which is
 * what the website has always used. That makes a post from before this build
 * playable rather than blank, and an unreachable server a slightly wrong puzzle
 * rather than no game.
 */
async function puzzleDay(): Promise<string | null> {
  try {
    const response = await fetch('/api/init');
    if (!response.ok) return null;
    const body = (await response.json()) as { puzzleDate?: unknown };
    return typeof body.puzzleDate === 'string' ? body.puzzleDate : null;
  } catch {
    return null;
  }
}

const day = await puzzleDay();
if (day) setPuzzleDay(day);

// Route in memory rather than off the address bar. The frame's URL is one the
// player never sees and cannot link to, and a reload would ask the static
// server for `/leaderboard`, which has no rewrite in front of it. The header's
// tabs are the navigation, which is all a player inside a post has anyway.
setInMemoryRouting(true);

// `Root` rather than `App`: the puzzle is one of five pages, and the other four
// -- the header, the boards, the finds -- are the rest of the game. Rendering
// the puzzle alone left everything the server does for the leaderboard with no
// way to be seen.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
