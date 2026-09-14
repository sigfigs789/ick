import { useEffect, useState } from "react";
import { trackFoundWordsOpened, trackLeaderboardOpened } from "../analytics";
import { navigate, type Route } from "../routes";

/**
 * How long the "Scoring update" badge stays before fading out.
 *
 * Long enough to be read by somebody who opened the app and looked at the
 * puzzle first, short enough that it is gone before it becomes furniture. It
 * fades on every load rather than once ever: the badge is what catches the eye,
 * and the button it points at is what remains -- so a player who missed it on
 * Monday still gets a shot at it on Tuesday, and a player who has read it three
 * times is not stuck looking at it.
 */
const BADGE_VISIBLE_MS = 10_000;

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
  onFreeform,
}: {
  route: Route;
  onHowToPlay: () => void;
  /**
   * Open the Freeform week notice. Absent outside the trial week, which is what
   * takes the button off the header again once it is over -- there is no
   * announcement to read, so there is nothing to point at.
   */
  onFreeform?: () => void;
}) {
  const freeform = Boolean(onFreeform);
  /**
   * Whether the badge is still up. Keyed off `freeform` rather than the callback
   * itself, which is a fresh arrow on every parent render and would restart the
   * timer with it.
   */
  const [badgeShowing, setBadgeShowing] = useState(true);
  useEffect(() => {
    if (!freeform) return;
    const timer = setTimeout(() => setBadgeShowing(false), BADGE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [freeform]);

  /**
   * Open the sheet and retire the badge in the same gesture. Pressing either one
   * is the badge having worked, so it has no business sitting there afterwards
   * waiting out its timer over a sheet the player has already read.
   */
  function openFreeform() {
    setBadgeShowing(false);
    onFreeform?.();
  }

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
        {/* Sits before the "?" so the two read left to right as
            news-then-reference, and so the badge under it is not hard against
            the edge of a phone.

            A word rather than a glyph. An "i" in a circle is the same shape as
            the "?" beside it and says even less -- between two identical
            circles a player has no way to tell the rules from the news without
            pressing one. "Freeform" names the week it opens, and the badge
            under it says what kind of week that is.

            Shown to everybody rather than only to whoever has not read the
            sheet: it is a label on the rules currently in force, not an unread
            marker. The button stays all week; the badge is the part that fades,
            having done its job once the eye has landed on it. */}
        {onFreeform && (
          <div className="app__freeform-nav">
            <button
              type="button"
              className="app__freeform-button"
              onClick={openFreeform}
              aria-label="Freeform week — what’s changed"
            >
              Freeform
            </button>
            {/* Decoration: the button's own label above already carries this,
                so the badge is not announced a second time -- and it is skipped
                by the keyboard for the same reason. It takes a press anyway,
                because it is the part of the pair the eye is on, and a label
                that ignores the finger aimed at it reads as broken. The button
                behind it is the accessible control and does the same thing. */}
            <span
              className={`app__freeform-badge${
                badgeShowing ? "" : " app__freeform-badge--faded"
              }`}
              aria-hidden="true"
              onClick={openFreeform}
            >
              Scoring update
            </span>
          </div>
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
          return (
            <button
              key={tab.route}
              type="button"
              className={`app__nav-item${current ? " app__nav-item--current" : ""}`}
              onClick={() => go(tab)}
              aria-current={current ? "page" : undefined}
            >
              <span className="app__nav-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
}
