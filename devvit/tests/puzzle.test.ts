/**
 * One post a day.
 *
 * A post does not hold a puzzle -- the game reads the day off the player's own
 * device, as it does on the website. What must not be wrong here is idempotence. The job that creates a
 * post runs on a schedule, and a schedule can fire twice -- a retry after a
 * timeout, a run that overlaps the last one, a moderator tapping the menu while
 * it happens. Two posts for one puzzle splits its players and its comments
 * across both, and no later cleanup can put that back together.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRedis } from "./redis-fake";

const redis = new FakeRedis();
const context: { postId?: string; subredditName?: string } = { subredditName: "wordinkdev" };
const submitted: { subredditName: string; title: string }[] = [];
let nextPostId = 0;

const reddit = {
  submitCustomPost: vi.fn(async (opts: { subredditName: string; title: string }) => {
    submitted.push(opts);
    nextPostId += 1;
    return { id: `t3_${nextPostId}` };
  }),
};

vi.mock("@devvit/web/server", () => ({ redis, reddit, context }));

const { createPuzzlePost } = await import("../src/server/core/puzzle");

beforeEach(() => {
  Object.assign(redis, new FakeRedis());
  submitted.length = 0;
  nextPostId = 0;
  reddit.submitCustomPost.mockClear();
  context.subredditName = "wordinkdev";
});

describe("creating a puzzle's post", () => {
  it("posts once for a day it has not posted for", async () => {
    const { postId, created } = await createPuzzlePost("2026-07-08");
    expect(created).toBe(true);
    expect(postId).toBeTruthy();
  });

  it("does not post the same puzzle twice", async () => {
    const first = await createPuzzlePost("2026-07-08");
    const second = await createPuzzlePost("2026-07-08");

    expect(second).toEqual({ postId: first.postId, created: false });
    expect(reddit.submitCustomPost).toHaveBeenCalledTimes(1);
  });

  it("posts again on a different day", async () => {
    const first = await createPuzzlePost("2026-07-08");
    const second = await createPuzzlePost("2026-07-09");
    expect(second.postId).not.toBe(first.postId);
    expect(second.created).toBe(true);
  });

  it("titles the post with the day it went up, and never with the drop", async () => {
    await createPuzzlePost("2026-07-08");
    // The drop in the title would put the puzzle in the feed, and not knowing it
    // until you open it is the whole game.
    expect(submitted[0]?.title).toBe("WordInk — July 8, 2026");
  });

  it("posts to the subreddit it is installed in", async () => {
    context.subredditName = "somewhereelse";
    await createPuzzlePost("2026-07-08");
    expect(submitted[0]?.subredditName).toBe("somewhereelse");
  });
});
