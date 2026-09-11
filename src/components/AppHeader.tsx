import { trackFoundWordsOpened, trackLeaderboardOpened } from "../analytics";
import { navigate, type Route } from "../routes";

/** One tab: where it goes and what it is called. */
interface Tab {
  route: Route;
  label: string;
}

/**
 * The three pages, in the order a player meets them: the puzzle, then the two
 * things you go and look at once you have played it.
 *
 * Labels alone, no glyphs. A trophy is guessable and a scroll is not, and
 * neither of them says which of the two lists of words you are about to get --
 * the boards rank players and the feed collects words, which is exactly the
 * distinction an icon cannot draw. Once the word is doing all the work, the
 * glyph above it was decoration with a claim on the header's height.
 */
const TABS: readonly Tab[] = [
  { route: "game", label: "Play" },
  { route: "leaderboard", label: "Leaderboards" },
  // "Words found" rather than "Today's finds": the page does not only hold
  // today's -- it opens there, but stepping back a day is a thing it offers,
  // and a tab that promises today then shows Tuesday has misnamed itself. The
  // heading on the page is the one that says which day you are looking at.
  { route: "found-words", label: "Words found" },
];

/**
 * The header every page wears: the wordmark, the way to the rules, and the tabs
 * between the three pages.
 *
 * Rendered once above the router (see src/Root.tsx) rather than by each page, so
 * it is literally the same element across a navigation -- nothing to keep in
 * step, and no page that can quietly grow a header of its own. That is also what
 * makes the tabs worth having: before this, the leaderboard's only way out was a
 * back arrow, so the two pages beside the puzzle were reachable only from the
 * puzzle, and going between them meant passing through it.
 */
export function AppHeader({
  route,
  onHowToPlay,
}: {
  route: Route;
  onHowToPlay: () => void;
}) {
  function go(tab: Tab) {
    if (tab.route === route) return;
    if (tab.route === "leaderboard") trackLeaderboardOpened("header");
    if (tab.route === "found-words") trackFoundWordsOpened("header");
    navigate(tab.route);
  }

  return (
    <header className="app__header">
      <div className="app__header-bar">
        {/* The wordmark carries the beta chip rather than a banner: the game
            really is changing under players week to week, and a permanent
            label sets that expectation once, in the one place every screen
            shows, without spending a row of the puzzle to say it. Title on
            the chip so the curious get the reason.

            An h1 on the puzzle and a plain word elsewhere. The other two pages
            have a heading of their own that says what they are, and two h1s on
            one page is a worse answer to "what is this" than either alone. */}
        {route === "game" ? (
          <h1 className="app__wordmark">
            WordInk
            <span
              className="app__beta"
              title="Still being built — rules and scoring may change."
            >
              beta
            </span>
          </h1>
        ) : (
          <p className="app__wordmark">
            WordInk
            <span
              className="app__beta"
              title="Still being built — rules and scoring may change."
            >
              beta
            </span>
          </p>
        )}
        <button
          type="button"
          className="app__icon-button"
          onClick={onHowToPlay}
          aria-label="How to play"
        >
          ?
        </button>
      </div>
      {/* Under the wordmark rather than beside it: three labelled destinations
          do not fit a phone's width next to a wordmark, and a row of its own
          lets each tab be a real target at its full name. */}
      <nav className="app__nav" aria-label="Pages">
        {TABS.map((tab) => {
          const current = tab.route === route;
          return (
            <button
              key={tab.route}
              type="button"
              className={`app__nav-item${current ? " app__nav-item--current" : ""}`}
              onClick={() => go(tab)}
              aria-current={current ? "page" : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
