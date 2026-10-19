/**
 * The live fold rejections for one puzzle, as the shared client reads them.
 *
 * Same path, query parameter and response body as `api/folded-live.ts`, so
 * `src/game/liveFoldRejections.ts` needs no branch for which host it runs on.
 * The answer is the website's own, imported on the scheduler's clock (see
 * core/import.ts) -- there is nothing to reject from inside a post, and the
 * page that rejects is unreachable here, so only the read is served.
 *
 * Nothing imported yet is an empty list rather than an error: it is what the
 * game would have done anyway, which is play every fold as the dictionary has
 * it.
 */

import { Hono } from 'hono';
import { DATE_RE } from '../../shared/leaderboard';
import { importedFoldRejections } from '../core/import';

export const foldedLive = new Hono();

foldedLive.get('/', async (c) => {
  const date = new URL(c.req.url).searchParams.get('date') ?? '';
  if (!DATE_RE.test(date)) return c.json({ error: 'bad-date' }, 400);
  return c.json({ rejections: await importedFoldRejections(date) });
});
