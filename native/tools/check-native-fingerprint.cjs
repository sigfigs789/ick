#!/usr/bin/env node
/* global __dirname */
// Fail when the native layer changed and the runtime version did not.
//
// An over-the-air update reaches only builds with the same `runtimeVersion`
// (app.json). It is a hand-set label rather than Expo's "fingerprint" policy
// because that policy hashed differently on the EAS build machine than here
// and in CI -- build 10 embedded one runtime and CI published updates to
// another, so no update could ever have reached it. A label cannot disagree
// with itself.
//
// What a label loses is noticing native changes, which is what this puts back:
// the native layer's fingerprint is recorded in native-fingerprint.json beside
// the runtime version it belongs to. A new Expo module, an SDK bump or a plugin
// change moves the fingerprint, and CI stops here until the runtime version is
// raised -- because JavaScript published to the old label would reach builds
// missing the native code it expects, and crash them.
//
//   node tools/check-native-fingerprint.cjs          check (CI)
//   node tools/check-native-fingerprint.cjs --write  record, after raising runtimeVersion
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const recordPath = path.join(root, 'native-fingerprint.json');

const runtimeVersion = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo
  .runtimeVersion;
if (typeof runtimeVersion !== 'string') {
  console.error('app.json expo.runtimeVersion must be a string label.');
  process.exit(1);
}

const output = execFileSync(
  'npx',
  ['expo-updates', 'fingerprint:generate', '--platform', 'ios'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
);
const fingerprint = JSON.parse(output).hash;

if (process.argv.includes('--write')) {
  fs.writeFileSync(recordPath, `${JSON.stringify({ runtimeVersion, fingerprint }, null, 2)}\n`);
  console.log(`Recorded runtime ${runtimeVersion} at fingerprint ${fingerprint}.`);
  process.exit(0);
}

const recorded = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
if (recorded.fingerprint === fingerprint && recorded.runtimeVersion === runtimeVersion) {
  console.log(`Native layer unchanged for runtime ${runtimeVersion}.`);
  process.exit(0);
}
if (recorded.fingerprint !== fingerprint && recorded.runtimeVersion === runtimeVersion) {
  console.error(
    `The native layer changed (fingerprint ${recorded.fingerprint} -> ${fingerprint}) ` +
      `but runtimeVersion is still "${runtimeVersion}".\n` +
      'Raise expo.runtimeVersion in native/app.json, run ' +
      '`node tools/check-native-fingerprint.cjs --write` in native/, and ship a store build: ' +
      'installed builds cannot run this code, so updates to the old runtime must stop.'
  );
} else {
  console.error(
    `native-fingerprint.json records runtime "${recorded.runtimeVersion}" but app.json says ` +
      `"${runtimeVersion}". Run \`node tools/check-native-fingerprint.cjs --write\` in native/.`
  );
}
process.exit(1);
