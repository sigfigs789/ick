import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPuzzlePost } from '../core/puzzle';

export const menu = new Hono();

/**
 * Put up a puzzle by hand.
 *
 * The scheduled job does this every day; this is the same call behind a
 * moderator's menu, which is how a playtest gets its first post without waiting
 * for midnight. Idempotent on the date like the job is, so a moderator who taps
 * it twice gets the same post rather than a second one.
 */
menu.post('/post-create', async (c) => {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const { postId, created } = await createPuzzlePost(date);

    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${postId}`,
        ...(created ? {} : { showToast: `${date} already has a post` }),
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});
