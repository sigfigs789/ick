import { useEffect, useRef, useState } from "react";
import { trackFoundWordsOpened, trackLeaderboardOpened } from "../analytics";
import { navigate, type Route } from "../routes";
import { ModeToggle } from "./ModeToggle";
import type { GameMode } from "../game/mode";

/**
 * How long the header badge stays before it is retired.
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

/**
 * The pages where the switch follows the reader down (see `docked` below): the
 * boards and the finds, whose long lists are read against the mode and
 * compared across it, and the puzzle itself.
 *
 * The puzzle was left out once, on the argument that it fits a screen. It
 * does not on a phone once the guess log fills and the results open under it,
 * and scrolled past the header, nothing above the input said which of the two
 * games was being played -- which is the one thing a player switching between
 * them most needs to see at the moment they guess.
 */
const DOCKED_SWITCH_ROUTES: readonly Route[] = ["game", "leaderboard", "found-words"];

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
  mode,
  onModeChange,
  badge = true,
  badgeLabel,
  onBadgeDone,
}: {
  route: Route;
  onHowToPlay: () => void;
  /**
   * Open the trial week's notice. Passed only while the trial is running, which
   * is what takes the button off the header once it is over.
   *
   * The other half of a pair with `mode`/`onModeChange` below: this slot in the
   * header holds the week's notice until MODE_CHOICE_START and the mode switch
   * from it, and never both -- the two eras do not overlap, because the trial
   * ends on the day the switch appears. Which one is offered is src/Root.tsx's
   * decision; this file only draws whichever it was handed.
   */
  onFreeform?: () => void;
  /**
   * The mode the player is in, and the way to change it. Absent before
   * MODE_CHOICE_START, which is what keeps the switch off the header while the
   * calendar is still deciding -- there is nothing to choose yet.
   */
  mode?: GameMode;
  onModeChange?: (mode: GameMode) => void;
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
   * What the badge says. Passed in rather than written here because the button
   * carries more than one piece of news across the trial -- the week's scoring
   * change first, its extension later -- and which one is owed is a question
   * about the calendar and this player's storage, both of which live with the
   * rest of the announcement's state in src/Root.tsx. The header's job is to
   * put the words under the button and take them away on time.
   *
   * No label, no badge: a header asked to show the button without any news to
   * put under it draws the button alone, rather than an empty pill or one
   * wearing a wording this file had no business keeping a copy of.
   */
  badgeLabel?: string;
  /**
   * The badge is finished: it has been up for its ten seconds, or it has been
   * pressed. Said upwards rather than remembered here, because "this player has
   * met the announcement" outlives the header and belongs with the rest of the
   * announcement's state.
   */
  onBadgeDone?: () => void;
}) {
  // Whether this header has anything in its news-or-control slot, which is what
  // a badge needs to sit under. Either era counts; they never coincide.
  const switchable = Boolean(onFreeform) || Boolean(mode && onModeChange);

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

  /**
   * Whether the header's switch has scrolled out of view, which is when its
   * docked copy appears at the top of the column.
   *
   * A copy that exists only while the original is off screen, rather than
   * sticking the header itself: the header is two rows and the wordmark, a
   * fifth of a phone's height, to keep one pill in reach. And never both at
   * once, so there is only ever one "Mode" button to find, by eye or by screen
   * reader.
   */
  const modeNav = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState(false);
  const dockable =
    Boolean(mode && onModeChange) && DOCKED_SWITCH_ROUTES.includes(route);
  useEffect(() => {
    const target = modeNav.current;
    // No observer (jsdom, very old browsers) is no dock: the header's switch
    // is still there, a scroll away.
    if (!dockable || !target || typeof IntersectionObserver !== "function") {
      setDocked(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) =>
      setDocked(!entry.isIntersecting),
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [dockable]);
  useEffect(() => {
    badgeDone.current = onBadgeDone;
  });

  useEffect(() => {
    // No label is no badge on screen (see `badgeLabel`), and a badge nobody can
    // see has nothing to finish -- timing one out would retire an announcement
    // that was never made.
    if (!switchable || !badge || !badgeLabel) return;
    const timer = setTimeout(() => badgeDone.current?.(), BADGE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [switchable, badge, badgeLabel]);

  /**
   * Switch modes and retire the badge in the same gesture. Pressing either one
   * is the badge having worked -- it exists to point at this control, and once
   * the control has been used it has nothing left to point at.
   */
  function changeMode(next: GameMode) {
    onBadgeDone?.();
    onModeChange?.(next);
  }

  /**
   * Open the trial's sheet and retire the badge in the same gesture. Pressing
   * either one is the badge having worked, so it has no business sitting there
   * afterwards waiting out its timer over a sheet the player has already read.
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
    <>
    <header className="app__header">
      <div className="app__header-bar">
        {/* The wordmark carries the beta chip rather than a banner: the game
            really is changing under players week to week, and a permanent
            label sets that expectation once, in the one place every screen
            shows, without spending a row of the puzzle to say it. Title on
            the chip so the curious get the reason.

            An h1 on the puzzle and a plain word elsewhere. The other two pages
            have a heading of their own that says what they are, and two h1s on
            one page is a worse answer to "what is this" than either alone.

            "Ink" wears the Mythic red, as it does in the app: it is the half of
            the name that makes it this game. No space between the spans, so it
            still reads -- and is announced -- as the one word. */}
        {route === "game" ? (
          <h1 className="app__wordmark">
            Word<span className="app__wordmark-ink">Ink</span>
            <span
              className="app__beta"
              title="Still being built — rules and scoring may change."
            >
              beta
            </span>
          </h1>
        ) : (
          <p className="app__wordmark">
            Word<span className="app__wordmark-ink">Ink</span>
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
            state-then-reference, and so the badge under it is not hard against
            the edge of a phone.

            A word rather than a glyph, for the same reason it was a word when
            it announced the week: an icon here would be a second circle beside
            the "?" saying even less. The label names the mode you are in, and
            the badge under it says the label is something you can press. */}
        {/* The trial's button, while the trial is running. Unchanged from the
            week it was built for: a word rather than a glyph, because an "i" in
            a circle is the same shape as the "?" beside it and says less. */}
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
            {/* Decoration: the button's own label above already carries this, so
                the badge is not announced a second time -- and it is skipped by
                the keyboard for the same reason. It takes a press anyway,
                because it is the part of the pair the eye is on, and a label
                that ignores the finger aimed at it reads as broken. */}
            {badgeLabel && (
              <span
                className={`app__freeform-badge${
                  badge ? "" : " app__freeform-badge--faded"
                }`}
                aria-hidden="true"
                onClick={openFreeform}
              >
                {badgeLabel}
              </span>
            )}
          </div>
        )}
        {mode && onModeChange && (
          <div className="app__mode-nav" ref={modeNav}>
            <ModeToggle mode={mode} onChange={changeMode} />
            {/* Decoration: the toggle's own accessible name already says both
                the mode and where pressing goes, so the badge is not announced
                a second time -- and it is skipped by the keyboard for the same
                reason. It takes a press anyway, because it is the part of the
                pair the eye is on, and a label that ignores the finger aimed at
                it reads as broken. The button behind it is the accessible
                control and does the same thing. */}
            {badgeLabel && (
              <span
                className={`app__mode-badge${badge ? "" : " app__mode-badge--faded"}`}
                aria-hidden="true"
                onClick={() => changeMode(mode === "standard" ? "freeform" : "standard")}
              >
                {badgeLabel}
              </span>
            )}
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
    {/* Zero-height and sticky, as a direct child of the page column, so the
        pill rides at the column's own right edge at every width without this
        file knowing what that width is. */}
    {dockable && docked && mode && (
      <div className="app__mode-dock">
        <ModeToggle mode={mode} onChange={changeMode} />
      </div>
    )}
    </>
  );
}
