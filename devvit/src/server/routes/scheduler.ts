/**
 * The scheduled jobs, which for now means one: pull the website's board in.
 *
 * Reached by the scheduler rather than by a player, so nothing here is on any
 * critical path -- a failure leaves the last successful import cached and the
 * board carries on with slightly older website rows beside live Reddit ones.
 */

import { Hono } from 'hono';
import { importBoard, importFinds, importFoldRejections } from '../core/import';
import { createPuzzlePost } from '../core/puzzle';
import { gameDay, monthStartOf, weekStartOf } from '../../shared/windows';

export const scheduler = new Hono();

scheduler.post('/import', async (c) => {
  const rows = await importEverything();
  return c.json({ rows });
});

/**
 * Pull the website's players in, for every window a reader can be looking at.
 *
 * Exported because three things need it and they must not drift: the schedule,
 * the install (so a fresh subreddit is not staring at an empty board for the
 * first quarter of an hour), and a moderator who wants it now.
 */
export async function importEverything(): Promise<number> {
  // UTC's own day. The windows a player asks for are computed on *their*
  // calendar, so an import keyed to UTC can be a day off at the edges -- which
  // is why neighbouring days are fetched too rather than only today's.
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = shiftDays(today, -1);
  const tomorrow = shiftDays(today, 1);

  // Both boards, since the website keeps one per mode and a player reads the
  // one for the mode they play.
  const boards = (['standard', 'freeform'] as const).flatMap((mode) => [
    // Both weeks and both months a player's local date can fall in, so a reader
    // on either side of the date line finds their window already cached.
    importBoard('w', weekStartOf(yesterday), mode),
    importBoard('w', weekStartOf(tomorrow), mode),
    importBoard('m', monthStartOf(yesterday), mode),
    importBoard('m', monthStartOf(tomorrow), mode),
    importBoard('d', yesterday, mode),
    importBoard('d', today, mode),
    importBoard('d', tomorrow, mode),
  ]);
  const imported = await Promise.all([
    ...boards,
    importFinds(yesterday),
    importFinds(today),
    importFinds(tomorrow),
    importFoldRejections(yesterday),
    importFoldRejections(today),
    importFoldRejections(tomorrow),
  ]);

  const rows = imported.reduce((sum, count) => sum + count, 0);
  console.log(`import: ${rows} row(s) across ${imported.length} window(s)`);
  return rows;
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Put up the day's puzzle.
 *
 * UTC's day, because a post has to be made at some single moment and UTC is the
 * only clock a server has. It is not the same question the website answers --
 * there "today" is the reader's own calendar date, which is right for a page
 * anybody can open at any time. Here the post *is* the puzzle, so the only thing
 * that matters is that exactly one goes up a day and that it says which day it
 * is. Both hold under any timezone.
 */
scheduler.post('/daily-post', async (c) => {
  const date = gameDay();
  const { postId, created } = await createPuzzlePost(date);
  console.log(`daily-post: ${date} -> ${postId}${created ? '' : ' (already posted)'}`);
  return c.json({ postId, created });
});
