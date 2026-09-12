import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { devvit } from '@devvit/start/vite';

export default defineConfig({
  plugins: [react(), tailwind(), devvit()],
  resolve: {
    /*
     * One React, not two.
     *
     * The client imports the game from the repo's own `src/`, which is outside
     * this project. Node resolution walks up from wherever a file sits, so the
     * game's modules find the repo root's React and this project's own modules
     * find the one in `devvit/node_modules` -- two copies in one bundle, two
     * dispatchers, and every hook in the game reading `useState` off a null
     * one. The page renders nothing and the only clue is a TypeError from the
     * jsx runtime.
     *
     * Pinned to the repo root's copy rather than this project's, because that
     * is the React the game's forty components are written and tested against.
     * This project's own client files are a splash and a mount, and they do not
     * care which they get.
     */
    dedupe: ['react', 'react-dom'],
    alias: {
      react: fileURLToPath(new URL('../node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('../node_modules/react-dom', import.meta.url)),
    },
  },
});
