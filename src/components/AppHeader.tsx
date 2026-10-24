import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { trackFoundWordsOpened, trackLeaderboardOpened, trackStatsOpened } from "../analytics";
import { navigate, pathFor, type Route } from "../routes";
import { ModeToggle } from "./ModeToggle";
import type { GameMode } from "../game/mode";
import type { MenuSheet } from "./MenuSheetModal";

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
 * compared across it.
 *
 * Not the puzzle. The play screen's input sits right under the drop, so the
 * header's switch is on screen whenever a guess is typed, and a docked copy
 * there only ever floated over the guess cards.
 */
const DOCKED_SWITCH_ROUTES: readonly Route[] = ["leaderboard", "found-words"];

/** One page in the bar: where it goes, what it is called, and its icon. */
interface Tab {
  route: Route;
  label: string;
  icon: ReactNode;
}

/** Shared by every icon in the bar: a 24-unit line drawing in the text colour. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * The pages beside the puzzle, as icons on the one bar -- the shape every daily
 * word game's header has settled on, and the only one that holds a wordmark and
 * four destinations on a 320px phone. The puzzle itself is the wordmark.
 *
 * Each icon keeps its page's name as its accessible name and its tooltip, so a
 * screen reader and a mouse both get the word the glyph stands for.
 */
const TABS: readonly Tab[] = [
  // A list, because the page is one: the words players found, ranked.
  // "Words found" rather than "Today's finds": the page does not only hold
  // today's -- it opens there, but stepping back a day is a thing it offers,
  // and a tab that promises today then shows Tuesday has misnamed itself. The
  // heading on the page is the one that says which day you are looking at.
  {
    route: "found-words",
    label: "Words found",
    icon: (
      <Icon>
        <path d="M9 6h12" />
        <path d="M9 12h12" />
        <path d="M9 18h12" />
        <path d="M4 6h.01" />
        <path d="M4 12h.01" />
        <path d="M4 18h.01" />
      </Icon>
    ),
  },
  // The player's own numbers, beside the words they found. Only once there are
  // any (see `showStats`).
  {
    route: "stats",
    label: "Stats",
    icon: (
      <Icon>
        <path d="M4 20V10" />
        <path d="M10 20V4" />
        <path d="M16 20v-7" />
        <path d="M2 20h20" />
      </Icon>
    ),
  },
  {
    route: "leaderboard",
    label: "Leaderboards",
    icon: (
      <Icon>
        <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
        <path d="M7 6H4a3 3 0 0 0 3 4" />
        <path d="M17 6h3a3 3 0 0 1-3 4" />
        <path d="M12 14v4" />
        <path d="M8 21h8l-1-3H9z" />
      </Icon>
    ),
  },
];

/**
 * The header every page wears: one bar with the wordmark, which is the way back
 * to the puzzle, an icon for each page beside it, and the "?" menu.
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
  onOpenSheet,
  onFreeform,
  mode,
  onModeChange,
  badge = true,
  badgeLabel,
  onBadgeDone,
  showStats = false,
}: {
  route: Route;
  onHowToPlay: () => void;
  /** Open Feedback or Suggest a word. Absent where the build takes no
   * messages, which is what keeps both off the menu. */
  onOpenSheet?: (sheet: MenuSheet) => void;
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
  /**
   * Whether the Stats tab is offered: once this browser has banked a word. A
   * player with no record has no stats, and a tab that opens on zeros is one
   * more thing on a first visit's header to read past.
   */
  showStats?: boolean;
}) {
  // Whether this header has the trial's button, the only thing a badge sits
  // under. The mode switch that replaced it wears none.
  const switchable = Boolean(onFreeform);

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
   * Whether the header has scrolled out of view, which is when the switch
   * docks at the top of the column on the boards and the finds.
   *
   * The switch itself lives in the "?" menu, out of the way of the puzzle; on
   * those two pages a long list is read against the mode, so once the header
   * has gone the pill follows the reader down.
   */
  const headerBar = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState(false);
  const dockable = Boolean(mode && onModeChange) && DOCKED_SWITCH_ROUTES.includes(route);
  useEffect(() => {
    const target = headerBar.current;
    // No observer (jsdom, very old browsers) is no dock: the menu's switch is
    // still there, a scroll away.
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

  /**
   * The "?" menu: the rules, feedback, word suggestions, the mode switch, and room for whatever the game
   * grows next (an account, say) without the bar growing with it.
   *
   * A disclosure rather than an ARIA menu: a button that shows a short list of
   * ordinary buttons, which every input already knows how to use. It closes on
   * a press outside it, on Escape (handing focus back to the "?"), and after
   * any choice in it.
   */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRoot.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButton.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);
  // A new page is a choice made elsewhere; the menu does not follow it there.
  useEffect(() => setMenuOpen(false), [route]);

  useEffect(() => {
    // No label is no badge on screen (see `badgeLabel`), and a badge nobody can
    // see has nothing to finish -- timing one out would retire an announcement
    // that was never made.
    if (!switchable || !badge || !badgeLabel) return;
    const timer = setTimeout(() => badgeDone.current?.(), BADGE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [switchable, badge, badgeLabel]);

  function changeMode(next: GameMode) {
    setMenuOpen(false);
    onModeChange?.(next);
  }

  function openRules() {
    setMenuOpen(false);
    onHowToPlay();
  }

  function openSheet(sheet: MenuSheet) {
    setMenuOpen(false);
    onOpenSheet?.(sheet);
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

  /** The wordmark is the way back to the puzzle, as a link so it opens in a
   * new tab like any other. */
  function goHome(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (route !== "game") navigate("game");
  }

  function go(tab: Tab) {
    if (tab.route === route) return;
    if (tab.route === "leaderboard") trackLeaderboardOpened("header");
    if (tab.route === "found-words") trackFoundWordsOpened("header");
    if (tab.route === "stats") trackStatsOpened("header");
    navigate(tab.route);
  }

  const wordmark = (
    <a className="app__wordmark-link" href={pathFor("game")} onClick={goHome}>
      Word<span className="app__wordmark-ink">Ink</span>
    </a>
  );

  return (
    <>
    <header className="app__header">
      <div className="app__header-bar" ref={headerBar}>
        {/* An h1 on the puzzle and a plain word elsewhere. The other pages
            have a heading of their own that says what they are, and two h1s on
            one page is a worse answer to "what is this" than either alone.

            "Ink" wears the Mythic red, as it does in the app: it is the half of
            the name that makes it this game. No space between the spans, so it
            still reads -- and is announced -- as the one word. */}
        {route === "game" ? (
          <h1 className="app__wordmark">{wordmark}</h1>
        ) : (
          <p className="app__wordmark">{wordmark}</p>
        )}
        <div className="app__header-actions">
        {/* The trial's button, on old puzzles from before the mode switch. */}
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
        <nav className="app__nav" aria-label="Pages">
          {TABS.filter((tab) => tab.route !== "stats" || showStats || route === "stats").map((tab) => {
            const current = tab.route === route;
            return (
              <button
                key={tab.route}
                type="button"
                className={`app__icon-button app__nav-item${current ? " app__nav-item--current" : ""}`}
                onClick={() => go(tab)}
                aria-current={current ? "page" : undefined}
                aria-label={tab.label}
                title={tab.label}
              >
                {tab.icon}
              </button>
            );
          })}
        </nav>
        <div className="app__menu" ref={menuRoot}>
          <button
            ref={menuButton}
            type="button"
            className="app__icon-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Help and settings"
            aria-expanded={menuOpen}
            aria-controls="app-menu"
            title="Help and settings"
          >
            ?
          </button>
          {menuOpen && (
            <div className="app__menu-panel" id="app-menu">
              <button type="button" className="app__menu-item" onClick={openRules}>
                How to play
              </button>
              {onOpenSheet && (
                <>
                  <button
                    type="button"
                    className="app__menu-item"
                    onClick={() => openSheet("suggest-word")}
                  >
                    Suggest a word
                  </button>
                  <button
                    type="button"
                    className="app__menu-item"
                    onClick={() => openSheet("feedback")}
                  >
                    Feedback
                  </button>
                </>
              )}
              {mode && onModeChange && (
                <div className="app__menu-item app__menu-mode">
                  <span>Mode</span>
                  <ModeToggle mode={mode} onChange={changeMode} />
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
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
