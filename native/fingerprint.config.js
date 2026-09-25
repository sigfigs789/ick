// What the native-fingerprint guard hashes (tools/check-native-fingerprint.cjs).
//
// The runtime version is a label set by hand in app.json, and an update only
// reaches builds carrying the same label -- so it has to change exactly when
// the native layer does. The guard fingerprints that layer and fails CI when it
// moves without the label moving with it.
//
// The store version is not native code: it is 1.<APP_VERSION> (see
// app.config.js), and APP_VERSION goes up every Friday. Left in, every weekly
// bump would look like a native change.
/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips: ['ExpoConfigVersions'],
};

module.exports = config;
