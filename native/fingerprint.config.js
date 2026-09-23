// What decides whether an over-the-air update can reach a build.
//
// The runtime version is a fingerprint of the native layer (app.json:
// runtimeVersion.policy "fingerprint"), so an update only reaches builds whose
// native code it was bundled against. The store version is not native code: it
// is 1.<APP_VERSION> (see app.config.js), and APP_VERSION goes up every Friday.
// Left in, every weekly bump would mint a new runtime and strand every
// installed build without updates -- which is the gap updates exist to close.
/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips: ['ExpoConfigVersions'],
};

module.exports = config;
