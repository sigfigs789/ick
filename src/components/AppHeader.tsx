import { useEffect, useState } from "react";
import { trackFoundWordsOpened, trackLeaderboardOpened } from "../analytics";
import { hasSeen, markSeen } from "../game/whatsNew";
import { navigate, type Route } from "../routes";

/** One tab: where it goes, what it is called, and the glyph over the label. */
interface Tab {
  route: Route;
  label: string;
  icon: string;
}

/**
 * The three pages, in the order a player meets them: the puzzle, then the two
 * things you go and look at once you have played it.
 *
 * Labels rather than a row of glyphs. A trophy is guessable and a scroll is not,
 * and neither of them says which of the two lists of words you are about to get
 * -- the boards rank players and the feed collects words, which is exactly the
 * distinction an icon cannot draw. The glyph stays as the thing the eye finds;
 * the word under it is what makes it a destination.
 */
const TABS: readonly Tab[] = [
  { route: "game", label: "Play", icon: "🧩" },
  { route: "leaderboard", label: "Leaderboards", icon: "🏆" },
  // "Today's finds" rather than "Found words": the page opens on today's
  // puzzle, and what brings anybody back to it through the day is what is
  // landing now. Stepping back a day is a thing the page offers once you are on
  // it, not the thing the tab is promising.
  { route: "found-words", label: "Today's finds", icon: "📜" },
  // The fold table (/folded-words) is deliberately not here. It is the whole
  // scoring rule written out -- a thing to check against, not a thing to play
  // with -- and a tab for it would put a 115,000-row answer key one press from
  // the puzzle. Reachable by typing the path, and by nothing on screen.
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
  instructionsOpen,
  onHowToPlay,
}: {
  route: Route;
  /**
   * Whether the how-to-play sheet is over the page, which the callout below
   * waits out. See the note on it.
   */
  instructionsOpen: boolean;
  onHowToPlay: () => void;
}) {
  // Read once on mount rather than on every render: it flips exactly once, in
  // the effect below, and reading storage during a render would be the only
  // thing here that did.
  const [leaderboardIsNew, setLeaderboardIsNew] = useState(
    () => !hasSeen("leaderboard"),
  );

  /**
   * Arriving is meeting it, however the player got here.
   *
   * Watched on the route rather than hung off the tab's own click, because the
   * tab is no longer the only door: the results panel links straight to the
   * board, and so does a shared URL. The badge's whole job is to say "there is
   * something here you haven't seen", and once they are looking at it there is
   * nothing left to say -- from whichever direction they arrived.
   */
  useEffect(() => {
    if (route !== "leaderboard") return;
    markSeen("leaderboard");
    setLeaderboardIsNew(false);
  }, [route]);

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
          lets each tab be a real target with its name under it. */}
      <nav className="app__nav" aria-label="Pages">
        {TABS.map((tab) => {
          const current = tab.route === route;
          const badged = tab.route === "leaderboard" && leaderboardIsNew;
          return (
            <button
              key={tab.route}
              type="button"
              className={`app__nav-item${current ? " app__nav-item--current" : ""}`}
              onClick={() => go(tab)}
              aria-current={current ? "page" : undefined}
              // The "(new)" rides on the accessible name, so a screen reader
              // hears the announcement once -- the dot and the callout below
              // are both hidden from it for the same reason.
              aria-label={badged ? `${tab.label} (new)` : undefined}
            >
              <span className="app__nav-icon" aria-hidden="true">
                {tab.icon}
              </span>
              <span className="app__nav-label">{tab.label}</span>
              {badged && (
                <>
                  <span className="app__icon-badge" aria-hidden="true" />
                  {/* The dot marks the tab; the callout says what is behind it,
                      because a badge nobody can decode is not an announcement.

                      Held back until the how-to-play sheet has been met: on a
                      first visit that sheet is open over this header, and a
                      callout pointing at a tab the player cannot reach yet is
                      noise arriving before the game itself. */}
                  {!instructionsOpen && (
                    <span className="app__icon-callout" aria-hidden="true">
                      New leaderboard
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
