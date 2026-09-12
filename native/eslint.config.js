const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // This project's own files only. The shared modules under `../src` are the
    // website's, and are linted by the website's own config from the repo root
    // -- running a second config over them would report on code this project
    // does not own.
    ignores: ['dist/*', '.expo/*'],
  },
  {
    rules: {
      /*
       * A rule about HTML, applied to something that is not HTML.
       *
       * `react/no-unescaped-entities` exists because a bare apostrophe or quote
       * in JSX can collide with the surrounding markup once a browser parses
       * it. There is no markup here: React Native renders `<Text>` children as
       * a string to a native text view, so `&apos;` would appear on screen as
       * the five characters `&apos;` rather than as an apostrophe.
       *
       * Following it would therefore make every contraction in the game's copy
       * -- "You've completed this puzzle", "Couldn't load the board" -- wrong
       * in the one place it is visible.
       */
      'react/no-unescaped-entities': 'off',
    },
  },
]);
