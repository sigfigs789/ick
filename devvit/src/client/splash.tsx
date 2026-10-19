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
    {/* The wordmark the app stores show, cut from native/assets/icon.png, as an
        image rather than set in type: the frame cannot load the site's fonts,
        and a fallback face would make the name look like somebody else's. One
        cut per theme, because Reddit draws the post on the viewer's. */}
    <h1 className="splash__name">
      <picture>
        <source srcSet="/wordmark-dark.png" media="(prefers-color-scheme: dark)" />
        <img className="splash__wordmark" src="/wordmark.png" alt="WordInk" width={839} height={164} />
      </picture>
    </h1>
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
