import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { leaderboard } from './routes/leaderboard';
import { validate } from './routes/validate';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';
import { scheduler } from './routes/scheduler';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);
internal.route('/scheduler', scheduler);

app.route('/api', api);
// The path the shared client already fetches, unchanged from the website.
app.route('/api/leaderboard', leaderboard);
app.route('/api/validate', validate);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
