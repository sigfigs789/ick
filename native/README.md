# Ink (native)

React Native / Expo port of [Ink](..), the daily word-drop puzzle. Same
rules, same puzzle data, same day-to-day streak as the web version — this
is a second client for the same game, not a fork of it.

## Getting started

```bash
npm install
npm start        # then press i / a / w, or scan the QR code with Expo Go
```

Requires Xcode (iOS Simulator) or Android Studio (Android emulator) to run
natively, or Expo Go on a physical device. `npm run web` runs it in a
browser via react-native-web, useful for a quick visual check without a
simulator.

## What's ported directly vs. rewritten

- **`src/game/*.ts` and `src/data/*.json`** are copied verbatim from the
  web app (`../src/game`, `../src/data`) — pure TypeScript with no
  DOM dependency, exactly as the web README predicted when it called this
  out as a porting target. `src/game/storage.ts` is the one exception:
  same rules, rewritten against `AsyncStorage` (async) instead of
  `localStorage` (sync) — see below.
- **`src/components/*.tsx`** are rewritten with React Native primitives
  (`View`/`Text`/`Pressable`/`Animated`) instead of DOM elements, styled to
  match `../src/index.css` as closely as native styling allows — see
  `src/theme/theme.ts`, which mirrors the CSS custom properties (including
  the dark mode palette) 1:1.
- **`src/audio/sound.ts`** plays the same three tones as the web version's
  Web Audio synthesis, but precomputed to short WAV data URIs (React
  Native has nothing equivalent to synthesize with live) — see
  `scripts/synth-tones.js`, which renders them from the exact same
  oscillator/envelope math as `../src/audio/sound.ts`. Regenerate with
  `npm run synth-tones` if those tones ever change on the web side.
- **Sharing** copies the same spoiler-free result text to the clipboard
  (`expo-clipboard`) rather than opening a native share sheet, matching
  the web version's "Copied!" button instead of introducing new behavior.

## Async storage vs. sync localStorage

The web app's `storage.ts` reads/writes `localStorage` synchronously, so
`useDailyPuzzle` can seed its state straight from a `useState` initializer.
`AsyncStorage` is async, so this port's `useDailyPuzzle` starts from a
placeholder and loads the real progress/streak in an effect, exposing an
`isLoading` flag the app root uses to hold the splash screen up until
that's resolved (`App.tsx`). The storage *rules* (auto-complete at 6
words, lock-in, streak-only-moves-on-the-real-date) are unchanged — see
`src/game/storage.ts`'s doc comments, copied from the web version.

## Fonts

Same two Google Fonts as the web version (Karla for body text, Libre
Franklin for display/numerals), loaded via `@expo-google-fonts/*` and
`expo-font` instead of the web's `<link>` tags.
