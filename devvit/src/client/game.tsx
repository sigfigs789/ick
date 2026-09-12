// The WordInk puzzle itself, rendered inside the Reddit post's expanded webview.
//
// The game is the same React tree the website runs; it is imported from the
// repo's own `src/` rather than copied, so the two front-ends cannot drift.
// What differs is everything around it -- identity, storage, and the puzzle of
// the day all come from the post rather than from the browser -- and that
// seam is the work tracked in devvit/README.md.
import '../../../src/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../../src/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
