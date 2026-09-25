// The store version, derived rather than written.
//
// Everything else about the app lives in app.json, which Expo hands in here as
// `config`. The one field this file owns is `version`, the marketing version
// both stores show: it is always `1.<APP_VERSION>`, where APP_VERSION is the
// website's release counter in the repo's `src/version.ts`. A build therefore
// says which website release it was cut from, and the gap between the version
// in the stores and the one on wordink.app is how far the app has fallen
// behind.
//
// Read as text rather than imported: the constant sits in a TypeScript module
// and this file is plain Node. The pattern is strict on purpose -- if
// version.ts is ever reshaped, the build stops here instead of shipping a
// version that no longer tracks the site.
const fs = require('node:fs');
const path = require('node:path');

const VERSION_FILE = path.resolve(__dirname, '..', 'src', 'version.ts');

function webAppVersion() {
  const source = fs.readFileSync(VERSION_FILE, 'utf8');
  const match = source.match(/^export const APP_VERSION = (\d+);$/m);
  if (!match) {
    throw new Error(`No \`export const APP_VERSION = <integer>;\` in ${VERSION_FILE}`);
  }
  return Number(match[1]);
}

module.exports = ({ config }) => ({
  ...config,
  version: `1.${webAppVersion()}`,
});
