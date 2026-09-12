import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPuzzlePost } from '../core/puzzle';
import { importEverything } from './scheduler';
import { gameDay } from '../../shared/windows';

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
    const date = gameDay();
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

/**
 * Pull the website's players in now, rather than at the next quarter hour.
 *
 * The same import the schedule runs. Here because the first thing anybody does
 * after changing a setting is look to see whether it worked, and waiting a
 * quarter of an hour to find out is how a working import gets diagnosed as a
 * broken one.
 */
menu.post('/import-now', async (c) => {
  try {
    const rows = await importEverything();
    return c.json<UiResponse>(
      {
        showToast: rows > 0 ? `Imported ${rows} rows from the website` : 'Imported nothing -- check the app settings',
      },
      200
    );
  } catch (error) {
    console.error(`Error importing: ${error}`);
    return c.json<UiResponse>({ showToast: 'Import failed' }, 400);
  }
});
