module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // The shared code is written for Vite, which answers `import.meta.env`.
    // Metro emits CommonJS, where `import.meta` is a syntax error. See the
    // plugin for what it rewrites and why the value is what it is.
    plugins: ['./tools/babel-plugin-import-meta-env.cjs'],
  };
};
