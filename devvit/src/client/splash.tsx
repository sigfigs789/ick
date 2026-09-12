// The post as it appears in the feed, before anybody opens it.
//
// Deliberately tells you nothing about today's letters: not knowing them until
// you tap is the game, and a splash that showed them would answer the puzzle to
// everybody scrolling past.
import './splash.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export const Splash = () => (
  <div className="splash">
    <img className="splash__mark" src="/icon.png" alt="" width={84} height={84} />
    <h1 className="splash__name">WordInk</h1>
    <p className="splash__tagline">
      A daily word-drop puzzle. Find the rarest words hiding the day&rsquo;s letters.
    </p>
    <button
      className="splash__play"
      type="button"
      onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
    >
      Play
    </button>
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
