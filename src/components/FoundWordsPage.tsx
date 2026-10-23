import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RarityBadge } from "./RarityBadge";
import {
  fetchFoundWords,
  feedFloor,
  repriceFoundWords,
  type FetchOptions,
  type FoundWord,
} from "../game/leaderboard";
import { pageCache } from "../game/pageCache";
import { useGameMode } from "../hooks/useGameMode";
import { useWordDataLoaded } from "../hooks/useWordDataLoaded";
import { addDays, formatDateLabel, todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { navigate } from "../routes";

type LoadState = "loading" | "ready" | "error";

/**
 * How often an open page re-checks for new finds.
 *
 * Fifteen seconds, which is what the endpoint's CDN cache is set to: polling
 * faster returns the same bytes and polling slower wastes freshness already paid
 * for. See api/leaderboard.ts.
 */
const REFRESH_MS = 15_000;

/**
 * The finds, as their own page at /found-words.
 *
 * It was the bottom half of the leaderboard, and the seam was visible from the
 * start: a board row is a *player* and a find is a *word*, one is read to see
 * where you came and the other to see what you missed. They also move at
 * completely different speeds -- the boards are fetched once and left alone,
 * while this list is polled through the day -- so the live half sat under two
 * lists that had not changed since breakfast, a scroll away from anybody who
 * opened the page to read it.
 *
 * Its own page, its own URL to send somebody, and its own tab in the header. The
 * boards lost nothing: everything they said, they still say.
 */
/**
 * Every day's finds read this visit, so stepping back to one is instant -- and
 * so is coming back to the page from the puzzle (see game/pageCache.ts).
 *
 * Only ever shown while the day is re-read underneath (see `showDay`): a past
 * day still gains the odd word from archive play, and today's gains them all
 * day.
 */
const wordsCache = pageCache<readonly FoundWord[]>();

export function FoundWordsPage() {
  // Today's finds, if this visit has read them: the page opens on them rather
  // than on a skeleton, and the first read below brings them up to date.
  const [words, setWords] = useState<readonly FoundWord[]>(
    () => wordsCache.get(todayDateString()) ?? [],
  );
  /**
   * The feed's load state.
   *
   * It has one because the feed can be asked a question whose answer is
   * legitimately nothing: an earlier day of the week nobody found a word on. An
   * empty list and a list still in flight are different answers to a question
   * the reader just asked, and each has to be said out loud.
   */
  const [feedState, setFeedState] = useState<LoadState>(() =>
    wordsCache.has(todayDateString()) ? "ready" : "loading",
  );
  /**
   * The puzzle this page opened on, fixed at mount.
   *
   * Read once rather than on every render, so it moves only on a refresh -- the
   * same way the game fixes its own date (useDailyPuzzle). Both come from the
   * same clock, so they name the same drop, and the finds here are the finds for
   * the drop the player was just looking at. Read on every render instead, a tab
   * left open would cross midnight and swap the whole list to a new drop
   * mid-poll, under a reader who never asked for it.
   */
  const [today] = useState(todayDateString);
  /** The puzzle the list is about -- today's, until a reader steps back. */
  const [viewing, setViewing] = useState(today);
  /**
   * How far back the feed steps (see feedFloor): the first day any find was
   * recorded.
   *
   * Held in state beside `today` rather than read as the page renders. It is a
   * constant now, so nothing would move if it were -- but it is read for the
   * same reason `today` is, and a floor that goes back to answering a clock
   * should go back to answering it once per mount.
   */
  const [floor] = useState(feedFloor);
  const isToday = viewing === today;
  const canGoBack = viewing > floor;
  /**
   * The list as the reader would have been scored for it.
   *
   * The feed holds both modes' finds, and each word is priced by the rules of
   * the mode the *reader* is in -- so flipping the switch repaints every badge
   * here the way it repaints the puzzle, with nothing fetched. `mode` is read
   * only to re-run this; the pricing itself asks game/mode.ts. The rejection
   * metadata and the deferred scoring data are the same kind of trigger: until
   * they are in, a word the reader's rules refuse by register is judged as
   * merely unknown, and a word priced off an estimate shows the wrong score.
   */
  const [mode] = useGameMode();
  const metadataLoaded = useWordDataLoaded();
  const priced = useMemo(
    () => repriceFoundWords(words),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mode` and `metadataLoaded` are triggers
    [words, mode, metadataLoaded],
  );

  /** The day on screen, for a response to check it is still wanted. */
  const viewingRef = useRef(viewing);
  viewingRef.current = viewing;

  /**
   * Re-read the finds for the day on screen.
   *
   * A failure is swallowed once there is a list to keep: the last good one is a
   * truer thing to show than an empty section over one bad minute. A failure on
   * the *first* read of a day is different -- there is nothing behind it, and
   * silently showing an empty list would say nobody found anything -- so that
   * one becomes the feed's error state and offers a retry.
   */
  const refreshWords = useCallback(
    (options: FetchOptions = {}) => {
      const date = viewing;
      fetchFoundWords(date, options)
        .then((found) => {
          wordsCache.set(date, found);
          // A reader who stepped on while this was in flight is looking at
          // another drop now, and these rows are not its rows.
          if (viewingRef.current !== date) return;
          setWords(found);
          setFeedState("ready");
        })
        .catch(() => {
          if (viewingRef.current !== date) return;
          setFeedState((was) => (was === "loading" ? "error" : was));
        });
    },
    [viewing],
  );

  /**
   * Step the feed to another day of the week.
   *
   * Sets the day and nothing else; the effect that follows `viewing` does the
   * fetching. Nothing is prefetched, so a reader who never presses back costs
   * exactly what they cost before -- one request, for today.
   *
   * A day already read this visit goes straight back on screen and the request
   * only checks it -- a reader stepping back and forward is looking for
   * something they have just seen. A day not read yet clears the list, because
   * the heading names a drop and the rows under it have to be that drop's;
   * leaving yesterday's words under today's heading for the length of a request
   * would be the one wrong thing this could show. The empty list keeps its
   * height while it is in flight (see .found-words__list), so the page does not
   * collapse and spring back under the button that was just pressed.
   */
  const showDay = useCallback((date: string) => {
    const cached = wordsCache.get(date);
    setViewing(date);
    setWords(cached ?? []);
    setFeedState(cached ? "ready" : "loading");
  }, []);

  /**
   * How tall the list was, so the next day can be the same height while it
   * loads.
   *
   * A ref rather than state: it is read only at the moment a day is swapped, and
   * nothing should re-render because a count was recorded. The day arriving is
   * very often about as long as the day leaving -- the same players on the same
   * drop -- so the rows the skeleton holds open are close to the rows that
   * replace them.
   */
  const lastRowCount = useRef(0);
  useEffect(() => {
    if (words.length > 0) lastRowCount.current = words.length;
  }, [words]);

  /**
   * Read the finds for whichever day is on screen.
   *
   * Runs on the way in and again every time a reader steps to another day --
   * `refreshWords` is rebuilt only when `viewing` changes, so this is exactly
   * once per day looked at. A day nobody presses back to is never requested.
   */
  useEffect(() => {
    refreshWords();
  }, [refreshWords]);

  /**
   * Keep the feed current while the page is open.
   *
   * Today's finds land through the day, so a page left open would otherwise show
   * a snapshot from whenever it was opened -- and the one thing a live list must
   * not be is stale without saying so. Nothing runs while the tab is hidden -- a
   * backgrounded tab is not being read -- and coming back refreshes immediately
   * rather than waiting out the rest of an interval.
   */
  useEffect(() => {
    // Wrapped rather than passed straight to setInterval: the timer hands its
    // callback nothing, but a bare reference would also accept the event object
    // that other callers pass, and the options argument is not a thing a timer
    // should ever be able to set.
    const tick = () => refreshWords();
    // Only today's feed is live. A past day can still gain a word -- archive
    // play sends its finds, unranked (see game/leaderboard.ts, submitScore) --
    // but only at a trickle, and stepping back to the day reloads it. Polling it
    // would be a request a minute to be handed the same rows back.
    let timer = isToday ? window.setInterval(tick, REFRESH_MS) : 0;
    function onVisibilityChange() {
      window.clearInterval(timer);
      if (document.visibilityState === "hidden") return;
      if (isToday) refreshWords();
      if (isToday) timer = window.setInterval(tick, REFRESH_MS);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isToday, refreshWords]);

  /**
   * Which words turned up since the last look, so the feed can show them
   * arriving rather than just quietly containing them.
   *
   * The first load marks nothing: everything is new to a page that has just
   * opened, and animating the whole list would say "the whole day just arrived"
   * when none of it did. After that, each refresh diffs against what was already
   * on screen and only the genuinely new ones move.
   *
   * Finder counts rather than a bare set of words, because the feed is ordered
   * on a word's most recent sighting: somebody finding a word that is already on
   * screen lifts it back to the top with its count one higher, and that is the
   * same event as a new word landing. Marking only words never seen before would
   * leave the row that just moved the length of the list looking like it had
   * been sitting there.
   */
  const seenWords = useRef<Map<string, number> | null>(null);
  /**
   * Which day the counts above are about, so stepping to another one starts a
   * new baseline rather than reading a whole different puzzle's words as
   * arrivals.
   */
  const seenDay = useRef(today);
  /** Words on screen for the first time: a row that has to open a gap for itself. */
  const [arrived, setArrived] = useState<readonly string[]>([]);
  /**
   * Words already on screen that somebody else has now found: a row that is
   * travelling up rather than appearing.
   *
   * Held apart from `arrived` because the two look nothing alike. A new word
   * animates its own height open, since there was no row there a moment ago; a
   * re-found word already has a row, and playing the same animation on it would
   * collapse it to nothing and re-open it -- the one thing it is not doing. It
   * moves instead, and only the glow is shared.
   */
  const [refound, setRefound] = useState<readonly string[]>([]);

  useEffect(() => {
    const counts = new Map(words.map((entry) => [entry.word, entry.finders]));
    if (seenDay.current !== viewing) {
      // A day the reader asked for, arriving all at once because they asked --
      // which is not the same event as a word turning up under them, and gets
      // none of the animation that says so.
      seenDay.current = viewing;
      seenWords.current = counts.size > 0 ? counts : null;
      setArrived([]);
      setRefound([]);
      return;
    }
    if (seenWords.current === null) {
      // Nothing seen yet and nothing to see: an empty first response is not a
      // baseline, or the real first list would animate in as if it were new.
      if (counts.size === 0) return;
      seenWords.current = counts;
      return;
    }
    // Split by whether the word was on screen a moment ago. A count that went
    // *down* is neither: the day's words can only ever be found by more people,
    // so a smaller number is a word that dropped out of the response and came
    // back, not news.
    const seen = seenWords.current;
    const landed: string[] = [];
    const returned: string[] = [];
    for (const [word, finders] of counts) {
      const before = seen.get(word);
      if (before === undefined) landed.push(word);
      else if (finders > before) returned.push(word);
    }
    for (const [word, finders] of counts) {
      seen.set(word, Math.max(finders, seen.get(word) ?? 0));
    }
    if (landed.length === 0 && returned.length === 0) return;
    setArrived(landed);
    setRefound(returned);
    // Cleared once the animation is done, so a later re-render for some
    // unrelated reason does not replay it. Comfortably past the longest of them
    // -- the re-found glow, which runs 2.4s beside a 1s travel -- because
    // clearing the class mid-animation cuts the tint off rather than ending it.
    const timer = window.setTimeout(() => {
      setArrived([]);
      setRefound([]);
    }, 2800);
    return () => window.clearTimeout(timer);
  }, [viewing, words]);

  /**
   * Refresh, because a reader asked.
   *
   * With the cache-buster: a poll can be answered from the shared copy, but
   * somebody who taps this has just told you the list they are looking at is not
   * the one they want. No loading state -- the list on screen is the last true
   * answer, and blanking it to fetch something the reader can already see would
   * be a worse page than a slightly old one. The button says it is working; the
   * page stays readable underneath.
   */
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = useCallback(() => {
    setRefreshing(true);
    refreshWords({ fresh: true });
    // Long enough to read as a response to the tap, and it ends on its own
    // rather than on the request: it does not reject in a way this cares about,
    // and a button that stayed disabled because a fetch hung would be worse than
    // one that came back a moment early.
    window.setTimeout(() => setRefreshing(false), 600);
  }, [refreshWords]);

  // "Today's finds" while it is today's, and the day's own date once it isn't.
  // The date rather than "Yesterday": two steps back has no such word, and the
  // feed now walks back weeks, where a relative word says nothing at all.
  //
  // The page's own title rather than a heading inside the section, which is
  // where it used to sit when the section was the bottom half of the
  // leaderboard. Two headings saying the same thing, one under the other, is
  // what hoisting it avoids -- and this is the one thing on the page that says
  // which puzzle everything under it belongs to, which is what a title is.
  const heading = isToday
    ? "Today's finds"
    : `Finds from ${formatDateLabel(viewing)}`;

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {heading}{" "}
            {/* The drop, because without it the list is a pile of unrelated
                words: `asphyxiate` is just a word until you know the day asked
                for PHY. Quoted and inline rather than set in a chip: it is part
                of the sentence the title says -- finds from Sep 8's "ERE" -- and
                a badge beside it read as a second, unrelated label. */}
            <span className="found-words__drop">
              {"\u201c"}
              {dropForDate(viewing)}
              {"\u201d"}
            </span>
          </h1>
          <p className="page-head__note">
            Every word anybody turned up for this drop that the mode you’re in
            allows, scored by that mode.
          </p>
        </div>
        {/* A refresh belongs on the two pages whose content is other people's,
            and nowhere else in the app. */}
        <button
          type="button"
          className="app__icon-button leaderboard-page__refresh"
          onClick={refreshAll}
          disabled={refreshing}
          aria-label="Refresh"
          title="Refresh"
          data-refreshing={refreshing ? "" : undefined}
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>

      <FoundWords
        words={priced}
        heading={heading}
        isToday={isToday}
        state={feedState}
        // Never nothing and never a screenful: a first load has no previous day
        // to measure, and a very long day should not open a hole the list may
        // not fill.
        placeholderRows={Math.min(Math.max(lastRowCount.current, 4), 12)}
        arrived={arrived}
        refound={refound}
        canGoBack={canGoBack}
        canGoForward={!isToday}
        onBack={() => showDay(addDays(viewing, -1))}
        onForward={() => showDay(addDays(viewing, 1))}
        onRetry={() => {
          setFeedState("loading");
          refreshWords();
        }}
      />

      <button
        type="button"
        className="leaderboard-page__back"
        onClick={() => navigate("game")}
      >
        Back to today's puzzle
      </button>
    </main>
  );
}

/**
 * Every word found on one puzzle, newest first.
 *
 * One puzzle at a time, and today's until a reader presses back. The drop in the
 * heading is what makes the list mean anything -- `asphyxiate` is just a word
 * until you know the day asked for PHY -- so the feed is keyed to a puzzle date
 * rather than to a clock, and stepping back moves the whole heading with it.
 *
 * Back as far as the first day any find was recorded (see game/leaderboard.ts,
 * feedFloor) -- the whole archive, one press and one request at a time. It
 * stopped at the week's reset while it was the bottom half of the leaderboard,
 * where the week was the window the reader was already holding in their head.
 * Its own page is the game's record of what has been found, and a record that
 * forgot every Sunday night was the strange thing: a day's finds used to be gone
 * at the reader's midnight, and the words are the part of this page people come
 * back for.
 *
 * Every word rather than each player's best. The feed used to be built from the
 * one word per player the boards rank on, which made it a list of personal bests
 * and gave it a worse habit: that word is replaced when a player beats it, so a
 * find already on screen would disappear the moment its only finder did better.
 *
 * Its own section below the boards, rather than sharing the top of the page with
 * them. Both are lists of words, and a leaderboard row is a *player* while a
 * find is a *word* -- side by side that distinction is one nobody should have to
 * work out, so the two get separate headings and separate ground.
 *
 * A leaderboard tells you where you came; this tells you what you missed, and
 * "I did not know that was a word" is the thing players actually enjoy.
 */
function FoundWords({
  words,
  heading,
  isToday,
  state,
  placeholderRows,
  arrived,
  refound,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onRetry,
}: {
  words: readonly FoundWord[];
  /** What the page is calling this day, so the section is labelled the same. */
  heading: string;
  isToday: boolean;
  state: LoadState;
  /** How many rows to hold open while a day loads. */
  placeholderRows: number;
  arrived: readonly string[];
  refound: readonly string[];
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onRetry: () => void;
}) {
  /**
   * The rows, by word, so a re-ordering can be animated as movement.
   *
   * React keys the list by word, so when the order changes it *moves* the
   * existing node rather than rebuilding it -- the row is the same element in a
   * new place. That is what makes the animation below possible, and it is why
   * nothing here has to know which word travelled: the DOM already did it, and
   * this only replays the journey.
   */
  const rows = useRef(new Map<string, HTMLLIElement>());
  /** Where each row sat last time this ran, to measure the move against. */
  const wasAt = useRef(new Map<string, number>());

  /**
   * Slide the rows that moved from where they were to where they now are.
   *
   * The standard trick: the DOM is already in its final state by the time this
   * runs, so each row is offset *back* to where it used to be with no transition,
   * the layout is flushed, and then the offset is released -- the CSS transition
   * on `.found-words__item` carries it home. The reader sees the row travel; the
   * browser only ever laid it out once.
   *
   * `offsetTop` rather than a bounding rect, so a page that scrolled between two
   * polls does not read as every row having moved.
   *
   * Skipped entirely when a brand-new word is on screen. That row animates its
   * own height open, which pushes everything below it down as a matter of
   * layout, and the established insertion animation should own that frame rather
   * than fight a transform for it.
   */
  useLayoutEffect(() => {
    const before = wasAt.current;
    const now = new Map<string, number>();
    for (const [word, node] of rows.current) now.set(word, node.offsetTop);
    wasAt.current = now;
    if (arrived.length > 0) return;
    for (const [word, top] of now) {
      const previous = before.get(word);
      if (previous === undefined || previous === top) continue;
      const node = rows.current.get(word);
      if (!node) continue;
      node.style.transition = "none";
      node.style.transform = `translateY(${previous - top}px)`;
      // Read a layout property to flush the offset above before releasing it, or
      // the two writes coalesce into no move at all.
      void node.offsetHeight;
      node.style.transition = "";
      node.style.transform = "";
    }
  }, [words, arrived]);

  return (
    /* Labelled rather than headed: the page's title above it already names the
       day and the drop, and a heading here would be that sentence twice. The
       label keeps the region findable by name for anybody reading by landmark. */
    <section className="found-words" aria-label={heading}>
      {/* Both arrows always rendered, disabled at the ends rather than removed:
          a control that disappears at the edge of its range takes the shape of
          the thing with it, and a reader who has stepped back needs to see that
          forward exists before they know they can. */}
      <div className="found-words__nav">
        <button
          type="button"
          className="found-words__arrow"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label="Finds from the day before"
        >
          <span aria-hidden="true">‹</span>
          <span>Previous day</span>
        </button>
        <button
          type="button"
          className="found-words__arrow"
          onClick={onForward}
          disabled={!canGoForward}
          aria-label="Finds from the day after"
        >
          <span>Next day</span>
          <span aria-hidden="true">›</span>
        </button>
      </div>
      {/* One slot for whatever the day has to say, so the three answers -- a
          list, nothing, or a failure -- all occupy the same ground and the
          sections below do not move as a reader steps between days. */}
      {state === "error" ? (
        <p className="leaderboard__status" aria-live="polite">
          Couldn't load these finds.{" "}
          {/* Named apart from the boards' retry above it, which reads the same
              and does something else. Two buttons called "Try again" on one
              page are one button to anybody who reaches them by name. */}
          <button
            type="button"
            className="leaderboard__retry"
            onClick={onRetry}
            aria-label="Try loading the finds again"
          >
            Try again
          </button>
        </p>
      ) : state === "loading" ? (
        // Rows rather than a spinner, as many as the day just left had: the
        // request is one small query and usually lands in a moment, and what a
        // reader notices in that moment is the page under their thumb jumping,
        // not the absence of a message. Hidden from the reading order entirely
        // -- there is nothing here to read -- with the one sentence that is
        // worth saying announced instead.
        <>
          <p className="sr-only" aria-live="polite">
            Loading the finds…
          </p>
          <ul className="found-words__list" aria-hidden="true">
            {Array.from({ length: placeholderRows }, (_, i) => (
              <li
                key={i}
                className="found-words__item found-words__item--placeholder"
              />
            ))}
          </ul>
        </>
      ) : words.length === 0 ? (
        <p className="leaderboard__status">
          {isToday
            ? "Nobody's found anything yet today."
            : "Nobody found anything on this puzzle."}
        </p>
      ) : (
        <ul className="found-words__list">
          {words.map((found) => (
            <li
              key={found.word}
              ref={(node) => {
                if (node) rows.current.set(found.word, node);
                else rows.current.delete(found.word);
              }}
              className={`found-words__item${
                arrived.includes(found.word)
                  ? " found-words__item--arrived"
                  : ""
              }${
                refound.includes(found.word)
                  ? " found-words__item--refound"
                  : ""
              }`}
            >
              <span className="found-words__word">{found.word}</span>
              {/* Dated like the label is (see priceFind), or the number falls back
                  to the newest undated profile while the rank reads the
                  puzzle's: a 9.3 badged Mythic under the 0.3 lift. */}
              <RarityBadge
                rarity={found.rarity}
                zipf={found.zipf}
                date={found.foundOn || undefined}
              />
              {found.finders > 1 && (
                <span className="found-words__finders">
                  {found.finders} players
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
