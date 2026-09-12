/**
 * Whether a word the offline dictionary rejected is nonetheless a real one.
 *
 * The website answers this by asking Merriam-Webster and recording what it
 * hears. This build never asks Merriam-Webster: those keys are free
 * non-commercial ones, capped at 1,000 requests per reference per day for the
 * whole game, and a Reddit audience would spend that before lunch -- quite apart
 * from a licence that was not written with a second deployment in mind.
 *
 * Instead it reads the verdicts the website has already collected. A word the
 * site has judged is known here; a word it has not is `unknown`, which is
 * exactly what the client already does with a word Merriam-Webster has no entry
 * for -- the game's original rejection stands. The site's own play keeps filling
 * that table, so this build gets steadily better at no cost and without ever
 * holding a key.
 *
 * Read-through rather than imported wholesale. The verdict table is one row per
 * word the fallback has ever judged and has no ceiling, while the words a player
 * actually reaches for are few: the first player to try one pays a round trip,
 * and everybody after that is served from Redis.
 *
 * Nothing is ever written back. Verdicts flow one way, which is what keeps this
 * a read of public word data rather than a question about what may leave Reddit.
 */

import { redis, settings } from '@devvit/web/server';

/**
 * How long a real verdict is kept.
 *
 * Long, because a word's answer is a fact about English rather than about the
 * day. The website can correct one -- a word it wrongly approved, most likely --
 * and a week is how stale this build may be about that.
 */
const VERDICT_TTL_SECONDS = 7 * 24 * 60 * 60;
/**
 * How long "the website has never judged this" is kept.
 *
 * Much shorter, because it is the answer most likely to change: the site judging
 * a word for the first time is precisely the event this cache would otherwise
 * hide, and an hour bounds how long a newly known word stays unknown here.
 */
const UNKNOWN_TTL_SECONDS = 60 * 60;

/** The game's own input rule, and the bound the SQL applies to its argument. */
const WORD_RE = /^[a-z]{2,30}$/;

/** The body `api/validate.ts` answers with, which the shared client parses. */
export interface Verdict {
  word: string;
  outcome: 'playable' | 'rejected' | 'unknown' | 'error';
  reason: string | null;
  zipf: number | null;
  pos: string[];
  firstUse: string | null;
  source?: string | null;
  detail?: string;
}

/** One row of `word_verdict`, in the database's own spelling. */
interface RawVerdict {
  word: string;
  outcome: string;
  reason: string | null;
  zipf: number | string | null;
  pos: string[] | null;
  first_use: string | null;
  source: string | null;
}

const verdictKey = (word: string) => `verdict:${word}`;

/**
 * Look one word up.
 *
 * Never throws. Every failure becomes an `error` outcome carrying a reason,
 * because the client distinguishes the two and it matters which: `unknown` says
 * the word was judged and found wanting, and returning that for a lookup that
 * merely failed would reject a real word on no evidence.
 */
export async function verdictFor(word: string): Promise<Verdict> {
  const normalized = word.toLowerCase();
  if (!WORD_RE.test(normalized)) return blank(normalized, 'error', 'client-bad-request');

  const cached = await readCached(normalized);
  if (cached) return cached;

  const [url, key] = await Promise.all([
    settings.get<string>('supabaseUrl'),
    settings.get<string>('supabaseAnonKey'),
  ]);
  // `unconfigured` is one of the reasons the client treats as permanent: it
  // stops asking for the rest of the session rather than making a round trip per
  // guess that cannot be answered. An install with no settings is a game whose
  // dictionary is simply the bundled one, which is a working game.
  if (!url || !key) return blank(normalized, 'error', 'unconfigured');

  let rows: RawVerdict[];
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/word_verdict`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ p_word: normalized }),
    });
    if (!response.ok) {
      return blank(normalized, 'error', 'upstream-error', `HTTP ${response.status}`);
    }
    rows = (await response.json()) as RawVerdict[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The platform refusing the call is not a failed lookup, it is a lookup
    // that cannot happen here at all -- so it is reported as `forbidden`, which
    // the client treats as permanent and stops asking after. The alternative is
    // a doomed round trip on every unusual word, and a player's daily lookup
    // budget spent on requests that never left.
    const refused = message.includes('PERMISSION_DENIED') || message.includes('is not allowed');
    return blank(normalized, 'error', refused ? 'forbidden' : 'upstream-error', message);
  }

  const verdict = rows[0] ? read(rows[0]) : blank(normalized, 'unknown', null);
  await cache(normalized, verdict);
  return verdict;
}

/** One stored row as the client wants it: camelCase keys, numbers as numbers. */
function read(row: RawVerdict): Verdict {
  const outcome =
    row.outcome === 'playable' || row.outcome === 'rejected' || row.outcome === 'unknown'
      ? row.outcome
      : 'unknown';
  return {
    word: row.word,
    outcome,
    reason: row.reason,
    // Null is the game's unattested floor and is not the same as zero -- a word
    // no corpus attests is the rarest thing the game can score, and a zero would
    // make it the commonest.
    zipf: row.zipf === null || row.zipf === undefined ? null : Number(row.zipf),
    pos: row.pos ?? [],
    firstUse: row.first_use,
    source: row.source,
  };
}

function blank(
  word: string,
  outcome: Verdict['outcome'],
  reason: string | null,
  detail?: string
): Verdict {
  return {
    word,
    outcome,
    reason,
    zipf: null,
    pos: [],
    firstUse: null,
    ...(detail ? { detail } : {}),
  };
}

async function readCached(word: string): Promise<Verdict | null> {
  try {
    const raw = await redis.get(verdictKey(word));
    return raw ? (JSON.parse(raw) as Verdict) : null;
  } catch {
    // A cache that cannot be read is a cache miss, never an answer.
    return null;
  }
}

/**
 * Keep a verdict. Errors are never cached -- a failed lookup says nothing about
 * the word, and caching one would turn a blip into an hour of wrong answers.
 */
async function cache(word: string, verdict: Verdict): Promise<void> {
  if (verdict.outcome === 'error') return;
  await redis.set(verdictKey(word), JSON.stringify(verdict));
  await redis.expire(
    verdictKey(word),
    verdict.outcome === 'unknown' ? UNKNOWN_TTL_SECONDS : VERDICT_TTL_SECONDS
  );
}
