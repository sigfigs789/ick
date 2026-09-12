import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPuzzlePost } from '../core/puzzle';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    // Put today's puzzle up the moment the app lands, so a fresh install has
    // something to open rather than an empty subreddit until midnight.
    const date = new Date().toISOString().slice(0, 10);
    const { postId } = await createPuzzlePost(date);
    const input = await c.req.json<OnAppInstallRequest>();

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Posted ${date} in ${context.subredditName} as ${postId} (trigger: ${input.type})`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to create post',
      },
      400
    );
  }
});
