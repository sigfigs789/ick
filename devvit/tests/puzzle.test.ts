/**
 * One post, one puzzle.
 *
 * The thing that must not be wrong here is idempotence. The job that creates a
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

const { createPuzzlePost, puzzleDateFor } = await import("../src/server/core/puzzle");

beforeEach(() => {
  Object.assign(redis, new FakeRedis());
  submitted.length = 0;
  nextPostId = 0;
  reddit.submitCustomPost.mockClear();
  context.subredditName = "wordinkdev";
});

describe("creating a puzzle's post", () => {
  it("records which puzzle the post holds", async () => {
    const { postId, created } = await createPuzzlePost("2026-07-08");
    expect(created).toBe(true);
    expect(await puzzleDateFor(postId)).toBe("2026-07-08");
  });

  it("does not post the same puzzle twice", async () => {
    const first = await createPuzzlePost("2026-07-08");
    const second = await createPuzzlePost("2026-07-08");

    expect(second).toEqual({ postId: first.postId, created: false });
    expect(reddit.submitCustomPost).toHaveBeenCalledTimes(1);
  });

  it("posts a different puzzle on a different day", async () => {
    const first = await createPuzzlePost("2026-07-08");
    const second = await createPuzzlePost("2026-07-09");

    expect(second.postId).not.toBe(first.postId);
    expect(await puzzleDateFor(first.postId)).toBe("2026-07-08");
    expect(await puzzleDateFor(second.postId)).toBe("2026-07-09");
  });

  it("titles the post with the date and never with the drop", async () => {
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

describe("a post that records no puzzle", () => {
  it("answers null rather than guessing, so the client can fall back", async () => {
    // A post made before this build knew to write a date down. It stays playable
    // on the player's own clock, which is what the website has always used.
    expect(await puzzleDateFor("t3_ancient")).toBeNull();
  });
});

describe("the order the two keys are written in", () => {
  it("leaves a post knowing its day even if the claim never lands", async () => {
    // The puzzle is recorded before the day claims the post. A crash between
    // the two costs a duplicate post tomorrow -- visible, and fixable. The other
    // order costs a post nobody can read, which is neither.
    const { postId } = await createPuzzlePost("2026-07-08");
    const keys = redis.keysWritten();
    expect(keys.indexOf(`post:${postId}:day`)).toBeLessThan(keys.indexOf("day:2026-07-08:post"));
  });
});
