import { registerRootComponent } from 'expo';

// Before anything else, and before any import that could read them: the game's
// modules call `localStorage` at module scope and during render, so the shims
// have to be in place first. See src/host/install.ts.
import { installHost } from './src/host/install';

installHost();

// Imported after the shims by way of `require`, because ES imports are hoisted
// above the call above no matter where the statement is written -- and the
// whole point of this file is the ordering.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { App } = require('./src/App') as typeof import('./src/App');

registerRootComponent(App);
