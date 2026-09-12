/**
 * The day's post.
 *
 * A post does not hold a puzzle. The game reads the day off the player's own
 * device, here exactly as on the website, so every post opens whatever puzzle
 * it is for whoever opens it -- a doorway to the game rather than a container
 * for one day of it.
 *
 * What the date below is for is the posting itself: one post a day, titled with
 * the day it went up, and never two for the same day.
 */

import { context, reddit, redis } from '@devvit/web/server';

/** The post created for one puzzle, so a day is not posted twice. */
const puzzlePostKey = (date: string) => `day:${date}:post`;

/**
 * Create one puzzle's post, unless it already has one.
 *
 * Idempotent on the date, because the job that calls this runs on a schedule
 * and a schedule can fire twice: a retry after a timeout, a job that overlaps
 * its own next run. Two posts for one puzzle would split its players and its
 * comments across both, which is not something a later cleanup can undo.
 *
 * Returns the post's id, whether it was created now or already existed.
 */
export async function createPuzzlePost(date: string): Promise<{ postId: string; created: boolean }> {
  const existing = await redis.get(puzzlePostKey(date));
  if (existing) return { postId: existing, created: false };

  const { subredditName } = context;
  if (!subredditName) throw new Error('no subreddit in context');
  const post = await reddit.submitCustomPost({
    subredditName,
    title: titleFor(date),
  });

  await redis.set(puzzlePostKey(date), post.id);
  return { postId: post.id, created: true };
}

/**
 * What the post is called.
 *
 * The day it went up, and never the drop: a title carrying the drop would put
 * the puzzle in the feed, and the whole game is not knowing it until you open
 * it.
 */
function titleFor(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const label = new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return `WordInk — ${label}`;
}
