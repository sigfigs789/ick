// The post as it appears in the feed, before anybody opens it.
//
// Deliberately tells you nothing about today's letters: not knowing them until
// you tap is the game, and a splash that showed them would answer the puzzle to
// everybody scrolling past.
//
// The line is the site's own, from public/manifest.json. Worth keeping in step
// rather than writing a second one: this is the first thing most people on
// Reddit will ever read about the game, and it should describe it the way
// everywhere else does -- by what a player does, not by a coined term.
import './splash.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export const Splash = () => (
  <div className="splash">
    <img className="splash__mark" src="/icon.png" alt="" width={84} height={84} />
    <h1 className="splash__name">WordInk</h1>
    <p className="splash__tagline">
      A daily game where you find the rarest word you can that contains
      today&rsquo;s letters.
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
