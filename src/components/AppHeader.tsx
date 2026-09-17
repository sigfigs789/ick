import { useEffect, useRef } from "react";
import { trackFoundWordsOpened, trackLeaderboardOpened } from "../analytics";
import { navigate, type Route } from "../routes";

/**
 * How long the "Scoring update" badge stays before it is retired.
 *
 * Long enough to be read by somebody who opened the app and looked at the
 * puzzle first, short enough that it is gone before it becomes furniture. The
 * ten seconds are the badge's whole life, not this load's: when they run out it
 * is retired for good, exactly as if it had been pressed.
 *
 * That is the point of a badge. It is there to catch the eye once, and having
 * been up in front of the player for ten seconds is the eye having had its
 * chance -- an announcement that keeps reappearing until it is clicked is a nag,
 * and a player who read the two words and did not care has still read them. The
 * button underneath is what remains, all week, for anybody who wants the sheet
 * later.
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
  badge = true,
  onBadgeDone,
}: {
  route: Route;
  onHowToPlay: () => void;
  /**
   * Open the Freeform week notice. Absent outside the trial week, which is what
   * takes the button off the header again once it is over -- there is no
   * announcement to read, so there is nothing to point at.
   */
  onFreeform?: () => void;
  /**
   * Whether the badge is still owed -- false once this player has met the
   * announcement, in any session. The button is unaffected: it is a label on
   * the rules currently in force and stays all week either way.
   *
   * Defaults to owed so the badge is what a caller gets by not deciding; the
   * app decides in src/Root.tsx, which is where the announcement's one bit of
   * storage lives.
   */
  badge?: boolean;
  /**
   * The badge is finished: it has been up for its ten seconds, or it has been
   * pressed. Said upwards rather than remembered here, because "this player has
   * met the announcement" outlives the header and belongs with the rest of the
   * announcement's state.
   */
  onBadgeDone?: () => void;
}) {
  const freeform = Boolean(onFreeform);

  /**
   * The current `onBadgeDone`, reachable from a timer that must not be restarted
   * to reach it.
   *
   * The callback is a fresh arrow on every parent render, so an effect that
   * depended on it would clear and re-arm the timeout each time -- and a badge
   * whose ten seconds start over whenever the puzzle above it re-renders never
   * reaches ten seconds at all. The effect below depends on the two booleans
   * that actually decide whether a timer should exist, and reads the callback
   * through here when it fires.
   */
  const badgeDone = useRef(onBadgeDone);
  useEffect(() => {
    badgeDone.current = onBadgeDone;
  });

  useEffect(() => {
    if (!freeform || !badge) return;
    const timer = setTimeout(() => badgeDone.current?.(), BADGE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [freeform, badge]);

  /**
   * Open the sheet and retire the badge in the same gesture. Pressing either one
   * is the badge having worked, so it has no business sitting there afterwards
   * waiting out its timer over a sheet the player has already read.
   */
  function openFreeform() {
    onBadgeDone?.();
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
        {/* The two controls travel as a pair, in their own box. The bar is
            space-between, which spreads its children across the full width --
            with the wordmark, this and the "?" as three siblings that parked
            "Freeform" in the middle of the header on any screen wide enough to
            have a middle. Grouped, the bar has two children again and the pair
            stays at the right edge where the "?" has always been. */}
        <div className="app__header-actions">
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
            marker. The button stays all week; the badge is the part that goes,
            and it goes for good -- pressed, read and dismissed, or simply sat
            in front of the player for its ten seconds. */}
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
                badge ? "" : " app__freeform-badge--faded"
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
