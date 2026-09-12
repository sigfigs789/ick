/**
 * What the client needs before it can render: which puzzle, and who is playing.
 *
 * One request rather than two, because they are one question -- "what am I
 * looking at" -- and the client cannot draw anything until both are answered.
 */

import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import { puzzleDateFor } from '../core/puzzle';

export const init = new Hono();

init.get('/', async (c) => {
  const { postId } = context;
  const [username, puzzleDate] = await Promise.all([
    reddit.getCurrentUsername(),
    postId ? puzzleDateFor(postId) : Promise.resolve(null),
  ]);

  return c.json({
    postId: postId ?? null,
    username: username ?? null,
    // Null means this post records no puzzle -- one made before the build knew
    // to write one down. The client falls back to the clock, as the website
    // does, rather than refusing to draw.
    puzzleDate,
  });
});
