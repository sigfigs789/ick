/**
 * Vercel Analytics, for a host that is not a web page.
 *
 * `src/analytics.ts` imports `track` from this package at module scope. The
 * real SDK is a browser script and there is no page here to load it into, so
 * the import is redirected to this file (see metro.config.js).
 *
 * Nothing is lost by it being empty: this build calls `setReporting(false)`
 * before the first render (see src/host/install.ts), so `send` returns before
 * it reaches `track`. The stub exists so the *import* resolves, not so the
 * calls go somewhere -- and if reporting were ever switched on here by mistake,
 * a no-op is the right failure.
 */
export function track() {}

export default { track };
