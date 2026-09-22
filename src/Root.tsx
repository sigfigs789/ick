import { useEffect, useRef, useState } from "react";
import App from "./App";
import { trackLeaderboardJoined } from "./analytics";
import { AppHeader } from "./components/AppHeader";
import { FeedbackPage } from "./components/FeedbackPage";
import { FoundWordsPage } from "./components/FoundWordsPage";
import { FreeformFeedbackPage } from "./components/FreeformFeedbackPage";
import { FreeformModal } from "./components/FreeformModal";
import { InstructionsModal } from "./components/InstructionsModal";
import { LeaderboardPage } from "./components/LeaderboardPage";
import { SuggestedWordsPage } from "./components/SuggestedWordsPage";
import { TransferPage } from "./components/TransferPage";
import { DevDateBar } from "./dev/DevDateBar";
import { DEV_TOOLS } from "./dev/devTools";
import { todayDateString } from "./game/date";
import { usesFreeformRules } from "./game/dictionary";
import { modeIsChosen } from "./game/mode";
import { useGameMode } from "./hooks/useGameMode";
import { syncHistory } from "./game/leaderboard";
import { hasJoined, joinBoard } from "./game/player";
import { playedPuzzleCount } from "./game/storage";
import { hasSeen, headerBadgeFor, markSeen } from "./game/whatsNew";
import { useRoute } from "./routes";

/**
 * How long a tab has to have been away before returning to it re-syncs.
 *
 * The same five minutes the leaderboard uses to decide a board has gone stale,
 * and for the same reason: flicking to another tab and back is not an absence,
 * and without a threshold every glance away would cost a POST. Long enough that
 * ordinary tab-switching is free, short enough that a phone put down and picked
 * up again counts as opening the app -- which, on a phone, it is.
 */
const SYNC_STALE_MS = 5 * 60_000;

/**
 * How many puzzles a player has to have scored on before the Freeform notice
 * opens itself.
 *
 * One, because the notice is about a change to what a word is worth, and a
 * player with no puzzle behind them has no "worth" to change. A first-timer
 * meets the week as the game, so a sheet explaining how this week differs from
 * a game they have never played is noise standing between them and the board.
 * They can still read it: the header's "Freeform" button is there all week.
 */
const FREEFORM_MIN_PUZZLES = 1;

/** Seven pages under one header, picked off the address bar. See src/routes.ts. */
export function Root() {
  const route = useRoute();

  /**
   * The how-to-play sheet, owned here because the button that opens it is in the
   * header and the header is on every page.
   *
   * It used to live in the game, which was the only page with a "?" -- so a
   * player reading the boards had no way to check what a rank was made of
   * without going back to the puzzle first. Opening itself once for a
   * first-timer is unchanged: a player who never taps "?" never learns that
   * rarer scores higher, which is the whole game.
   *
   * Except on `/transfer`, which is the one page a first-timer can land on
   * having already played for months -- a new phone opening a link from the old
   * one (see components/TransferPage.tsx). That page asks a yes-or-no question
   * about an identity, and covering it with a sheet explaining what a Zipf score
   * is puts a dialog in front of a decision, for a reader who needs neither. The
   * sheet is still one tap away on the "?" like everywhere else, and it opens
   * itself on the next page they go to, which is the puzzle.
   */
  const [showInstructions, setShowInstructions] = useState(
    () => route !== "transfer" && !hasSeen("instructions"),
  );

  /**
   * Today's date, read once per mount.
   *
   * Today's rather than the puzzle being viewed: the notice is about the week
   * the player is in, so stepping back to an archived puzzle should not make it
   * appear or disappear. A tab left open across midnight keeps the value it
   * mounted with, which is the same thing every other date in this app does and
   * is not worth a timer -- being a day stale on a notice costs nothing.
   */
  const today = useRef(todayDateString());
  const freeform = usesFreeformRules(today.current);

  /**
   * The mode, owned here because the switch that changes it is in the header and
   * the header is on every page.
   *
   * Only offered from MODE_CHOICE_START. Before it the calendar decides -- the
   * trial week was freeform for everybody, and everything before that folded --
   * so a switch on the header would be a control that does nothing to the puzzle
   * under it.
   */
  const [mode, chooseMode] = useGameMode();
  const chooseable = modeIsChosen(today.current);

  /**
   * The Freeform week notice, opened once for the player and left reachable
   * from the header's "Freeform" button for the rest of the week.
   *
   * Once, permanently: `hasSeen` is the only gate, so a reload, a new tab or a
   * visit on Thursday cannot bring it back. A sheet that returns after it has
   * been read is a sheet the player learns to swipe away unread, which costs
   * more than the one open is worth.
   *
   * And only for a player who has played before -- see FREEFORM_MIN_PUZZLES.
   */
  const [showFreeform, setShowFreeform] = useState(
    () =>
      freeform &&
      !hasSeen("freeform") &&
      playedPuzzleCount() >= FREEFORM_MIN_PUZZLES,
  );

  /**
   * Which announcement the header's badge is carrying today, and the bit that
   * retires it. Chosen by the calendar, so the week's opening news gives way to
   * the extension on its own -- see `freeformBadgeFor`.
   *
   * Off `today.current`, which is read once per mount, so the pair cannot change
   * under a badge that is already up.
   */
  const badge = headerBadgeFor(today.current);

  /**
   * Whether that badge is still owed.
   *
   * Its own bit rather than the sheet's, because the two are met in different
   * ways and one of the ways is barely being met at all: the badge retires on
   * sight, after ten seconds of sitting in front of the player, and that is not
   * a player who has read what changed. Sharing a bit would have spent their one
   * automatic opening of the sheet on a label they merely glanced at.
   *
   * Held in state as well as storage so retiring it repaints the header
   * immediately -- `hasSeen` is read at mount and would not, on its own, notice
   * the answer changing under it.
   */
  const [freeformBadge, setFreeformBadge] = useState(
    () => badge !== null && !hasSeen(badge.key),
  );

  /**
   * The badge is finished: retire it, in this session and every one after.
   *
   * Every way it can finish comes through here -- pressed, its sheet read and
   * closed, or simply out of its ten seconds. All three are the badge having had
   * its moment, and none of them is worth a second one.
   *
   * This retires *today's* badge, not the badge as a mechanism: the extension
   * has its own bit, so dismissing "Scoring update" in week one leaves the
   * second announcement still owed, and the next thing worth announcing gets a
   * key in game/whatsNew.ts and a fresh one again.
   */
  function retireBadge() {
    if (badge) markSeen(badge.key);
    setFreeformBadge(false);
  }

  function closeFreeform() {
    // Opened by hand or opened for them: either way the announcement has been
    // delivered, so `markSeen` retires the automatic opening for good -- and the
    // badge with it, there being nothing left for it to point at.
    markSeen("freeform");
    retireBadge();
    setShowFreeform(false);
  }

  /**
   * Open the trial's sheet from the header.
   *
   * Only the badge is retired here. The sheet is about to be read, and closing
   * it is what retires the automatic opening -- a player who opens it by hand
   * and closes it unread is in exactly the same place as one who never opened
   * it, which is the case `closeFreeform` already handles for everyone.
   */
  function openFreeform() {
    retireBadge();
    setShowFreeform(true);
  }

  /**
   * Give this browser a board identity, on any page, before anything renders.
   *
   * Playing is the joining. It used to be opening the leaderboard: that page
   * minted the id, and nothing left the browser until somebody went there -- so
   * a player could find a dozen good words and have none of them reach the
   * board or the finds feed, because the whole record of a day's play hung on
   * whether anyone had tapped a trophy.
   *
   * What the id *is* has not changed: a UUID this browser invents (see
   * game/player.ts), kept in localStorage and sent with scores. No account, no
   * email, nothing typed, nothing about the person -- the name on the board is
   * computed from the id itself. The trade is worth stating plainly: a player
   * who never opens the leaderboard is now on it, where before they were not.
   * What goes up is exactly what that page shows, and none of it reaches back
   * into the game.
   *
   * Minted during render rather than in the effect below, which is the one
   * unusual thing here and is load-bearing: child effects run *before* a
   * parent's, so a player landing straight on /leaderboard would have that page
   * read the id, find none, and ask for boards without saying who was asking.
   * Doing it here puts the id in place before any child renders. Safe to run
   * twice (StrictMode does): `joinBoard` keeps the first id and returns it.
   */
  const joinedBefore = useRef(hasJoined());
  const playerId = useRef<string | null>(null);
  if (playerId.current === null) playerId.current = joinBoard();

  /**
   * When this browser last sent its history, so a return can tell a tab that
   * has been away from one that never left.
   */
  const syncedAt = useRef(0);

  /**
   * Send what this browser knows, every open -- not only on the first mint.
   *
   * Rows are written as the player plays, one request per accepted word, and
   * any of those can fail to land: a tunnel, a tab closed on the last word, a
   * five-hundred from the endpoint. Nothing retried them. The per-day write is
   * monotonic, so re-sending is a repair rather than a rewrite -- a day already
   * recorded is a no-op, and only the gaps land.
   *
   * That covers all three ages of a player's record at once: the days they
   * played before this browser had an id at all, whatever is already stored for
   * today, and -- through `submitScore` on the play path -- each word as it is
   * accepted from here on.
   */
  useEffect(() => {
    // Reported for the browser that just became a player, and not on the opens
    // after it: the first one is the interesting moment, and firing on every
    // load would turn the event into a visit count that already exists.
    if (!joinedBefore.current && playerId.current) trackLeaderboardJoined(false);
    syncHistory();
    syncedAt.current = Date.now();
  }, []);

  /**
   * And again when the app is reopened without being reloaded.
   *
   * A mount is not the only way somebody opens this app, and on a phone it is
   * not even the usual way: a tab is backgrounded rather than closed, and coming
   * back to it runs no effect and remounts nothing. A player whose word failed
   * to submit at lunch would sit on that hole until they happened to reload.
   *
   * Two events, because there are two ways a tab reappears -- foregrounded
   * (`visibilitychange`), and restored from the back/forward cache (`pageshow`
   * with `persisted`, which does not remount React either). The same pair
   * useForceUpdate watches, for the same reason: these are the moments a tab
   * that has been sitting somewhere actually resurfaces.
   */
  useEffect(() => {
    const sync = () => {
      if (Date.now() - syncedAt.current < SYNC_STALE_MS) return;
      // Re-read rather than trusted from mount: a browser that could not store
      // an id (private mode, storage off) is not a player, and never becomes
      // one by coming back to the tab.
      if (!hasJoined()) return;
      syncHistory();
      syncedAt.current = Date.now();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) sync();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return (
    /* The one page frame, so the header above the router is inside the column
       every page reads in. The two pages beside the puzzle are wider than it:
       the game's column is sized for one puzzle, and a board wants the room for
       a rank, a name, a find and a score on one line. */
    <div className={`app${route === "game" ? "" : " app--wide"}`}>
      <AppHeader
        route={route}
        onHowToPlay={() => setShowInstructions(true)}
        // One slot, two eras, never both at once. Until MODE_CHOICE_START the
        // header is the trial's and nothing here changes -- the button opens the
        // week's notice, exactly as it does today. From that date the trial is
        // over and the same slot holds the mode switch.
        onFreeform={!chooseable && freeform ? openFreeform : undefined}
        mode={chooseable ? mode : undefined}
        onModeChange={chooseable ? chooseMode : undefined}
        badge={freeformBadge}
        badgeLabel={badge?.label}
        onBadgeDone={retireBadge}
      />
      {route === "leaderboard" ? (
        <LeaderboardPage />
      ) : route === "found-words" ? (
        <FoundWordsPage />
      ) : route === "suggested-words" ? (
        /* The two review pages, which no tab points at: they render under the
           same header as everything else, because a page of this app is a page
           of this app -- there is nothing to be gained by giving a list its own
           frame, and the header's "?" is as welcome here as anywhere. */
        <SuggestedWordsPage />
      ) : route === "feedback" ? (
        <FeedbackPage />
      ) : route === "freeform-feedback" ? (
        <FreeformFeedbackPage />
      ) : route === "transfer" ? (
        <TransferPage />
      ) : (
        <App />
      )}
      {/* Queued behind the instructions rather than stacked on top of them: a
          first-timer during the week is owed both sheets, and two dialogs in
          one paint is not a way to deliver either. The how-to-play comes first
          because it is the one that explains what a score is, and this one
          appears as it closes. */}
      <FreeformModal
        open={showFreeform && !showInstructions}
        date={today.current}
        onClose={closeFreeform}
      />
      {/* Development and preview builds only: `DEV_TOOLS` folds to a constant, so
          this and everything under it drops out of a production build. */}
      {DEV_TOOLS && <DevDateBar />}
      <InstructionsModal
        open={showInstructions}
        onClose={() => {
          // Opened by hand or opened for them, either way they have now met the
          // rules: retire the auto-open for good.
          markSeen("instructions");
          setShowInstructions(false);
        }}
      />
    </div>
  );
}
