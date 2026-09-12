/**
 * The scheduled jobs, which for now means one: pull the website's board in.
 *
 * Reached by the scheduler rather than by a player, so nothing here is on any
 * critical path -- a failure leaves the last successful import cached and the
 * board carries on with slightly older website rows beside live Reddit ones.
 */

import { Hono } from 'hono';
import { importBoard, importFinds } from '../core/import';
import { monthStartOf, weekStartOf } from '../../shared/windows';

export const scheduler = new Hono();

scheduler.post('/import', async (c) => {
  // UTC's own day. The windows a player asks for are computed on *their*
  // calendar, so an import keyed to UTC can be a day off at the edges -- which
  // is why neighbouring days are fetched too rather than only today's.
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = shiftDays(today, -1);
  const tomorrow = shiftDays(today, 1);

  const imported = await Promise.all([
    // Both weeks and both months a player's local date can fall in, so a reader
    // on either side of the date line finds their window already cached.
    importBoard('w', weekStartOf(yesterday)),
    importBoard('w', weekStartOf(tomorrow)),
    importBoard('m', monthStartOf(yesterday)),
    importBoard('m', monthStartOf(tomorrow)),
    importBoard('d', yesterday),
    importBoard('d', today),
    importBoard('d', tomorrow),
    importFinds(yesterday),
    importFinds(today),
    importFinds(tomorrow),
  ]);

  const rows = imported.reduce((sum, count) => sum + count, 0);
  console.log(`import: ${rows} row(s) across ${imported.length} window(s)`);
  return c.json({ rows });
});

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
