/**
 * Whether the developer affordances are available in this build: the "Reset
 * answers" button, the date bar, the leaderboard's sample-data switch.
 *
 * True in `npm run dev`, and true on a Vercel *preview* deploy -- the branch
 * builds opened from a pull request. A preview is where a change is actually
 * looked at, and looking at it usually means moving the date to reach the
 * puzzle that shows the change, or clearing answers to play a drop again. Doing
 * that on a phone, against a real deploy, is the whole point of a preview;
 * without these it means running the dev server on a laptop instead.
 *
 * False on the production deploy, which is the only build a player gets. The
 * comparison is against a value Vite bakes in at build time (see vite.config.ts,
 * which sets VITE_DEV_TOOLS from Vercel's own VERCEL_ENV), so in production this
 * is the literal `false`: the branches fold away exactly as `import.meta.env.DEV`
 * folded away before, and the fixtures behind them stay out of the bundle.
 *
 * Read through `import.meta.env` rather than a defined global, because these
 * modules are bundled by three different tools -- Vite for the website, Vite
 * again for the Devvit client, and Metro for the app, which answers
 * `import.meta.env` through a babel plugin (see
 * native/tools/babel-plugin-import-meta-env.cjs). A bare global would be a
 * ReferenceError in two of the three. Neither of the other two sets
 * VITE_DEV_TOOLS, so both get `undefined`, and both fall back to their own
 * development flag.
 */
export const DEV_TOOLS: boolean =
  import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === "1";
