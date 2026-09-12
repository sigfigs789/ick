/**
 * Which puzzle a post holds.
 *
 * The website asks the player's clock what day it is, because on the web
 * "today's puzzle" should match the date on your wall -- the way a newspaper
 * puzzle does. Inside Reddit that question has a better answer: one post is one
 * puzzle, and the post knows which.
 *
 * That is not a workaround for the clock, it is a better model of the thing.
 * A player opening Tuesday's post on Friday is playing Tuesday's puzzle; the
 * comments under it are about Tuesday's drop, and a game that showed them
 * Friday's would be the odd one out on its own page. It also removes every
 * timezone question the website has to hold: two players either side of the date
 * line open the same post and get the same puzzle, because they are looking at
 * the same thing rather than at two clocks.
 *
 * The date is written when the post is created and never recomputed. A post is
 * a permanent object and its puzzle has to be too -- deriving it later from
 * anything, including the post's own age, would mean a post whose puzzle
 * changed under the people discussing it.
 */

import { context, reddit, redis } from '@devvit/web/server';

/** The puzzle one post holds. Written once, at creation. */
const postPuzzleKey = (postId: string) => `post:${postId}:day`;
/** The post created for one puzzle, so a day is not posted twice. */
const puzzlePostKey = (date: string) => `day:${date}:post`;

/**
 * The puzzle a post holds, or null if it holds none.
 *
 * Null is a real answer, not a failure: a post created before this build knew
 * to record a date has none, and the client falls back to the player's own
 * clock exactly as the website does. That keeps an old post playable rather
 * than blank.
 */
export async function puzzleDateFor(postId: string): Promise<string | null> {
  return (await redis.get(postPuzzleKey(postId))) ?? null;
}

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

  // The puzzle is recorded before the claim, so a crash between the two leaves a
  // post that knows its day rather than a day that has claimed a post nobody can
  // read. The worst case is a second post tomorrow, which is visible and
  // fixable; a post with no puzzle is neither.
  await redis.set(postPuzzleKey(post.id), date);
  await redis.set(puzzlePostKey(date), post.id);
  return { postId: post.id, created: true };
}

/**
 * What the post is called.
 *
 * The date rather than the drop: a title carrying the drop would put the puzzle
 * in the feed, and the whole game is not knowing it until you open it.
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
