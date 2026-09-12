import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPuzzlePost } from '../core/puzzle';
import { importEverything } from './scheduler';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    // Put today's puzzle up the moment the app lands, so a fresh install has
    // something to open rather than an empty subreddit until midnight.
    const date = new Date().toISOString().slice(0, 10);
    const { postId } = await createPuzzlePost(date);
    // And pull the website's players straight away. The schedule would do it
    // within the quarter hour, but a board is the emptiest it will ever be in
    // the minutes after an install, which is exactly when somebody looks.
    const rows = await importEverything();
    const input = await c.req.json<OnAppInstallRequest>();

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Posted ${date} in ${context.subredditName} as ${postId}, imported ${rows} row(s) (trigger: ${input.type})`,
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
