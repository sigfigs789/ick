/**
 * An in-memory stand-in for the twelve Redis commands the leaderboard uses.
 *
 * Devvit ships a `RedisMock`, and it is not what this is. That one implements
 * the wire protocol on top of a real `ioredis` client, which means installing
 * ioredis and assembling a plugin at the protobuf layer to test arithmetic. The
 * thing at risk in `core/leaderboard.ts` is the arithmetic -- which structures
 * move, by how much, in what order -- so the cheaper fake is the one that
 * actually puts pressure on it.
 *
 * The trade is honest but real: these are reimplementations of Redis semantics,
 * so a test passing here is evidence about the leaderboard's logic and not about
 * Redis. Where a command has a sharp edge that the leaderboard leans on, it is
 * matched deliberately and noted:
 *
 *   - `hMGet` returns `null` for a missing field, not `undefined`, which is what
 *     the real client's type says and what the hydrate path spreads over.
 *   - `zScore` returns `undefined` for a member that is not there.
 *   - sorted sets order by score ascending and break ties on the member's own
 *     name, which is what makes `reverse` deterministic -- and is exactly the
 *     ordering the board's over-read exists to overrule.
 *   - `zIncrBy` treats a missing member as zero, which is what lets a week's
 *     total be built from deltas without seeding it.
 */

export interface ZMember {
  member: string;
  score: number;
}

export interface ZRangeOptions {
  reverse?: boolean;
  by?: 'rank' | 'score' | 'lex';
}

export class FakeRedis {
  private hashes = new Map<string, Map<string, string>>();
  private zsets = new Map<string, Map<string, number>>();
  private strings = new Map<string, string>();
  private ttls = new Map<string, number>();
  /** Every key `set` has touched, in order, so a test can assert write order. */
  private written: string[] = [];

  // -- plain keys -----------------------------------------------------------
  // Where an imported board is cached, as one JSON blob per window.

  async get(key: string): Promise<string | undefined> {
    return this.strings.get(key);
  }

  async set(key: string, value: string): Promise<string> {
    this.strings.set(key, value);
    this.written.push(key);
    return 'OK';
  }

  /** The keys `set` has touched, in the order it touched them. */
  keysWritten(): string[] {
    return [...this.written];
  }

  /**
   * Recorded rather than simulated. No test here turns on a key ageing out, but
   * `ttlOf` lets one assert that a cached import was given an expiry at all --
   * an import cached forever would go stale silently.
   */
  async expire(key: string, seconds: number): Promise<void> {
    this.ttls.set(key, seconds);
  }

  /** The expiry set on a key, or undefined if none was. */
  ttlOf(key: string): number | undefined {
    return this.ttls.get(key);
  }

  // -- hashes ---------------------------------------------------------------

  async hSet(key: string, fieldValues: Record<string, string>): Promise<number> {
    const hash = this.hash(key);
    let added = 0;
    for (const [field, value] of Object.entries(fieldValues)) {
      if (!hash.has(field)) added += 1;
      hash.set(field, value);
    }
    return added;
  }

  async hSetNX(key: string, field: string, value: string): Promise<number> {
    const hash = this.hash(key);
    if (hash.has(field)) return 0;
    hash.set(field, value);
    return 1;
  }

  async hGet(key: string, field: string): Promise<string | undefined> {
    return this.hashes.get(key)?.get(field);
  }

  async hMGet(key: string, fields: string[]): Promise<(string | null)[]> {
    // Real Redis refuses HMGET with no fields -- "wrong number of arguments" --
    // and a fake that quietly answered `[]` let a board with no players ship
    // broken. Matched deliberately; the caller must not ask for nothing.
    if (fields.length === 0) {
      throw new Error("ERR wrong number of arguments for 'hmget' command");
    }
    const hash = this.hashes.get(key);
    return fields.map((field) => hash?.get(field) ?? null);
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }

  async hIncrBy(key: string, field: string, value: number): Promise<number> {
    const hash = this.hash(key);
    const next = Number(hash.get(field) ?? 0) + value;
    hash.set(field, String(next));
    return next;
  }

  async hLen(key: string): Promise<number> {
    return this.hashes.get(key)?.size ?? 0;
  }

  // -- sorted sets ----------------------------------------------------------

  async zAdd(key: string, ...members: ZMember[]): Promise<number> {
    const zset = this.zset(key);
    let added = 0;
    for (const { member, score } of members) {
      if (!zset.has(member)) added += 1;
      zset.set(member, score);
    }
    return added;
  }

  async zIncrBy(key: string, member: string, value: number): Promise<number> {
    const zset = this.zset(key);
    const next = (zset.get(member) ?? 0) + value;
    zset.set(member, next);
    return next;
  }

  async zScore(key: string, member: string): Promise<number | undefined> {
    return this.zsets.get(key)?.get(member);
  }

  async zCard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  async zRank(key: string, member: string): Promise<number | undefined> {
    const ordered = this.ordered(key);
    const at = ordered.findIndex((entry) => entry.member === member);
    return at < 0 ? undefined : at;
  }

  async zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options: ZRangeOptions = {}
  ): Promise<ZMember[]> {
    const ordered = options.reverse ? this.ordered(key).reverse() : this.ordered(key);
    // Only the rank-indexed form is used by the leaderboard, and a stop index
    // past the end is clamped the way Redis clamps it.
    const from = Number(start);
    const to = Number(stop);
    return ordered.slice(from, to + 1);
  }

  /** Score ascending, ties broken on the member's own name -- as Redis does. */
  private ordered(key: string): ZMember[] {
    return [...(this.zsets.get(key) ?? new Map())]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
  }

  private hash(key: string): Map<string, string> {
    let hash = this.hashes.get(key);
    if (!hash) this.hashes.set(key, (hash = new Map()));
    return hash;
  }

  private zset(key: string): Map<string, number> {
    let zset = this.zsets.get(key);
    if (!zset) this.zsets.set(key, (zset = new Map()));
    return zset;
  }
}
