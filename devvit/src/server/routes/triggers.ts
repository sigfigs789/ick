import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPuzzlePost } from '../core/puzzle';
import { importEverything } from './scheduler';
import { scheduler } from '@devvit/web/server';
import { gameDay } from '../../shared/windows';

export const triggers = new Hono();

/**
 * Installed, or upgraded to a new version.
 *
 * Both, and that is the fix rather than a convenience: every version after the
 * first arrives as an upgrade, so an import that only ran on install ran once,
 * before the settings it needs were ever set. A board sat empty for it.
 */
triggers.post('/on-app-install', async (c) => {
  try {
    // Put today's puzzle up the moment the app lands, so a fresh install has
    // something to open rather than an empty subreddit until midnight.
    const date = gameDay();
    const { postId } = await createPuzzlePost(date);
    // And pull the website's players straight away. The schedule would do it
    // within the quarter hour, but a board is the emptiest it will ever be in
    // the minutes after an install, which is exactly when somebody looks.
    const rows = await importEverything();
    // What the platform actually has scheduled, which is not something the
    // config file can tell you -- a cron declared there and a cron running are
    // two different claims, and only this one is evidence.
    const jobs = await scheduler.listJobs();
    console.log(
      `triggers: ${jobs.length} scheduled job(s): ${jobs.map((j) => j.name).join(', ') || 'none'}`
    );
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
