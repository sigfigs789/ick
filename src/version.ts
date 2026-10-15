// Single source of truth for app versioning.
//
// APP_VERSION: bump on every deploy you want to track. Baked into the bundle
//   at build time and written into the served version.json. The native app's
//   store version is 1.<APP_VERSION> — native/app.config.js reads this line as
//   text, so keep it a plain integer literal.
// MIN_VERSION: the required-version floor. Only bump this when you want to
//   FORCE every open tab below it to reload. Set it equal to APP_VERSION to
//   make the current release mandatory; leave it alone for optional deploys.
//
// MIN_RANKED_VERSION: the oldest release whose scores the leaderboard ranks.
//   Every total is priced on the client, by the rules that client was built
//   with. A web tab below MIN_VERSION reloads itself, but a store build is a
//   frozen copy of the game: one that never updates keeps pricing words by
//   rules the website has retired, on the same board. So api/leaderboard.ts
//   writes a submission below this floor, or one with no version, as
//   unranked -- it still plays and its finds still reach the feed. Published
//   in version.json, where the app reads it to pull an over-the-air update or,
//   failing that, show an update banner (native/src/hooks/useUpdateCheck.ts).
//   Raise it, with APP_VERSION, only when a release changes how a live or
//   coming puzzle is priced. A forced reload for any other reason is a
//   MIN_VERSION bump alone. Never above APP_VERSION, or nobody ranks.
//
// A running tab compares its baked-in APP_VERSION against the live
// version.json's minVersion and silently reloads only when it's below the
// floor. Reloading preserves all localStorage (game progress, streak, etc.).
//
// INVARIANT: index.html must never be long-cached. The forced reload only
// escapes the loop if it fetches a fresh index.html pointing at the new bundle;
// if index.html were cached below the floor, stale tabs would reload forever.
// vercel.json pins this with no-store on "/" and "/index.html" — keep it that
// way if you ever touch the caching headers.
export const APP_VERSION = 46;
export const MIN_VERSION = 46;
export const MIN_RANKED_VERSION = 42;
