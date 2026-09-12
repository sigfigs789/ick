/**
 * The live word check, answered from the website's verdicts.
 *
 * Same path, same query parameter and same response body as
 * `api/validate.ts`, so `src/game/liveValidate.ts` needs no branch for which
 * host it is running on. What differs is where the answer comes from: the
 * website asks Merriam-Webster, and this reads what the website has already
 * been told (see core/verdicts.ts for why).
 */

import { Hono } from 'hono';
import { verdictFor } from '../core/verdicts';

export const validate = new Hono();

validate.get('/', async (c) => {
  const word = new URL(c.req.url).searchParams.get('word') ?? '';
  const verdict = await verdictFor(word);
  // Always 200, as the website's endpoint is: the outcome carries the answer,
  // including that the lookup failed, and the client reads the body either way.
  return c.json(verdict);
});
