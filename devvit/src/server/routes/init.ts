/**
 * Who is playing.
 *
 * The website has no accounts, so its client invents a UUID and the board
 * computes a name from it. Here the player already has an account and the
 * server knows which -- so it says, and the client plays as that instead of as
 * the browser. Without this the player is told they are `CheeryCove52`, and is
 * never shown which row on the board is theirs, because the client is matching
 * a UUID against rows the server keys by username.
 *
 * The username and nothing else. The puzzle is the player's own day, read off
 * their device exactly as on the website, so there is nothing to ask about it.
 */

import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';

export const init = new Hono();

init.get('/', async (c) => {
  // Null for a logged-out reader, which is a real state: they can see the
  // boards and play, they simply have no account to be on one with.
  const username = await reddit.getCurrentUsername();
  return c.json({ username: username ?? null });
});
