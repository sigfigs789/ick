// Single source of truth for app versioning.
//
// APP_VERSION: bump on every deploy you want to track. Baked into the bundle
//   at build time and written into the served version.json.
// MIN_VERSION: the required-version floor. Only bump this when you want to
//   FORCE every open tab below it to reload. Set it equal to APP_VERSION to
//   make the current release mandatory; leave it alone for optional deploys.
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
export const APP_VERSION = 4;
export const MIN_VERSION = 4;
