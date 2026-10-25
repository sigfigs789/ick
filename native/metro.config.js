// Metro, taught to build from two roots.
//
// This project is a front-end, not a fork: the game itself -- the dictionary,
// the scoring, the fold, the storage format, the leaderboard client, and the
// hook that drives a day's play -- is the repo's own `src/`, imported rather
// than copied, exactly as the Reddit build does (see devvit/vite.config.ts).
// Only the view layer is written here.
//
// That means Metro has to watch a folder above its own project root, and it
// means two specific resolutions have to be forced, which is the whole of this
// file.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// The game's modules and its data live up there, so Metro has to watch it or a
// change to the dictionary never reaches a running app.
config.watchFolders = [repoRoot];

/*
 * One React.
 *
 * Node resolution walks *up* from the importing file, so `useDailyPuzzle.ts` --
 * which sits in the repo's `src/hooks/` -- finds the repo root's React 18,
 * while this project's own screens find the React 19 in `native/node_modules`.
 * Two copies in one bundle is two hook dispatchers, and every `useState` in the
 * game reads off whichever one is null. The failure is a blank screen and a
 * TypeError from inside the jsx runtime, which says nothing about the cause.
 *
 * Re-resolved as though the import had come from this project's own entry
 * point, which pins it to `native/node_modules` wherever it was actually
 * written. Deliberately a short list rather than switching the upward walk off
 * altogether: several Expo packages keep their own dependencies nested, and a
 * blanket `disableHierarchicalLookup` makes those unresolvable.
 */
const PINNED = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-native',
  // The chat's profanity filter, which the idle hint checks its words against
  // (src/game/idleHint.ts). EAS installs only this project, so a package the
  // shared code imports has to be a dependency here and resolved from here.
  'obscenity',
]);

/** Resolve as though asked from this project, not from wherever the import sits. */
const asProject = (context) => ({
  ...context,
  originModulePath: path.join(projectRoot, 'index.ts'),
});

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (PINNED.has(moduleName)) {
    return context.resolveRequest(asProject(context), moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
