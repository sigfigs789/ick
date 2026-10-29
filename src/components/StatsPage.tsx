import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACHIEVEMENT_GROUPS,
  earnedShareLabel,
  fetchAchievementRates,
  soleHolder,
  syncAchievements,
  type AchievementStatus,
} from "../game/achievements";
import { formatDateLabel } from "../game/date";
import { formatTotal } from "../game/dictionary";
import { MODE_LABELS } from "../game/mode";
import { CURRENT_TIERS, loadStats, TOP_WORDS, type PlayerStats, type StatWord } from "../game/stats";
import { loadStreak } from "../game/storage";
import type { Rarity } from "../game/types";
import { navigate } from "../routes";
import { RarityBadge } from "./RarityBadge";
import { rarityClassName } from "./rarityStyles";

/**
 * The player's own page, at /stats: their numbers, then their achievements.
 *
 * One page rather than two, because most achievements are a number on the
 * first half crossing a line -- the two halves are the same record read two
 * ways. Read once when the page opens, from this browser (see game/stats.ts,
 * game/achievements.ts); opening it is also what keeps a newly earned badge.
 */
export function StatsPage() {
  const [{ stats, achievements }] = useState(() => {
    const streak = loadStreak();
    return { stats: loadStats(streak), achievements: syncAchievements(streak) };
  });
  // The share under each badge starts from the bundled snapshot and redraws
  // once the live counts arrive (see fetchAchievementRates).
  const [, setLiveRates] = useState(false);
  useEffect(() => {
    void fetchAchievementRates().then((rates) => rates && setLiveRates(true));
  }, []);

  if (stats.wordsFound === 0) {
    return (
      <main className="stats">
        <div className="page-head">
          <h1 className="page-head__title">Your stats</h1>
        </div>
        <p className="stats__empty">
          Nothing here yet. Bank a word and your numbers start.{" "}
          <button type="button" className="stats__link" onClick={() => navigate("game")}>
            Play today’s puzzle
          </button>
        </p>
        {/* Every badge still waiting, so there is something to aim for. */}
        <Achievements statuses={achievements} />
      </main>
    );
  }

  return (
    <main className="stats">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Your stats</h1>
          <p className="page-head__note">From your play on this device.</p>
        </div>
      </div>
      <Headline stats={stats} />
      <RarityBars byRarity={stats.byRarity} />
      <BestWords stats={stats} />
      <ByMode stats={stats} />
      <Achievements statuses={achievements} />
    </main>
  );
}

function Headline({ stats }: { stats: PlayerStats }) {
  const tiles: { label: string; value: string; note?: string }[] = [
    { label: "Current streak", value: String(stats.currentStreak), note: "days" },
    { label: "Longest streak", value: String(stats.longestStreak), note: "days" },
    { label: "Days played", value: String(stats.daysPlayed) },
    { label: "Words found", value: String(stats.wordsFound) },
    { label: "Puzzles finished", value: String(stats.finished) },
    {
      label: "Longest word",
      value: stats.longestWord ? String(stats.longestWord.word.length) : "–",
      note: stats.longestWord?.word,
    },
  ];
  return (
    <section className="stats__tiles" aria-label="Headline numbers">
      {tiles.map((tile) => (
        <div className="stats__tile" key={tile.label}>
          <span className="stats__tile-label">{tile.label}</span>
          <span className="stats__tile-value">{tile.value}</span>
          {tile.note && <span className="stats__tile-note">{tile.note}</span>}
        </div>
      ))}
    </section>
  );
}

function RarityBars({ byRarity }: { byRarity: PlayerStats["byRarity"] }) {
  // Quotidian only where an old puzzle reached it.
  const tiers: Rarity[] = byRarity.Quotidian ? [...CURRENT_TIERS, "Quotidian"] : [...CURRENT_TIERS];
  const most = Math.max(1, ...tiers.map((tier) => byRarity[tier] ?? 0));
  return (
    <section className="stats__section" aria-labelledby="stats-rarity">
      <h2 className="stats__heading" id="stats-rarity">
        Words by rarity
      </h2>
      <ul className="stats__bars">
        {tiers.map((tier) => {
          const count = byRarity[tier] ?? 0;
          return (
            <li className="stats__bar-row" key={tier}>
              <span className="stats__bar-label">{tier}</span>
              <span className="stats__bar-track" aria-hidden="true">
                {/* The tier's dot colour, stretched: the badge's own palette
                    rule paints it, so the bars match the badges. */}
                <span
                  className={`stats__bar-fill ${rarityClassName(tier)}`}
                  style={{ width: `${(count / most) * 100}%` }}
                >
                  <span className="rarity-badge__dot" />
                </span>
              </span>
              <span className="stats__bar-count">{count}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BestWords({ stats }: { stats: PlayerStats }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Empty when every word found was on a legacy-scored puzzle (see game/stats.ts).
  if (stats.topWords.length === 0) return null;
  const total = stats.topWords.length;
  return (
    <section className="stats__section" aria-labelledby="stats-best">
      <h2 className="stats__heading" id="stats-best">
        Best words
      </h2>
      <BestWordList words={stats.topWords.slice(0, TOP_WORDS)} />
      {total > TOP_WORDS && (
        <div className="stats__more">
          <button type="button" className="stats__link" onClick={() => setOpen(true)}>
            Show more
          </button>
          <span className="stats__more-count">
            {TOP_WORDS} of {total}
          </span>
        </div>
      )}
      {open && <AllBestWords words={stats.topWords} onClose={close} />}
    </section>
  );
}

function BestWordList({ words }: { words: StatWord[] }) {
  return (
    <ol className="stats__words">
      {words.map((word) => (
        <li className="stats__word" key={`${word.word}-${word.date}`}>
          <span className="stats__word-text">{word.word}</span>
          <span className="stats__word-date">
            {formatDateLabel(word.date)}
            {word.mode === "freeform" ? ` · ${MODE_LABELS.freeform}` : ""}
          </span>
          <RarityBadge rarity={word.rarity} zipf={word.zipf} date={word.date} />
        </li>
      ))}
    </ol>
  );
}

/** How many more rows the modal renders each time the reader nears the bottom. */
const MODAL_BATCH = 30;

/**
 * Every best word, in a modal that renders a batch at a time and adds the
 * next as the sentinel below the list scrolls into view -- a long record
 * runs to thousands of words, each with a badge.
 */
function AllBestWords({ words, onClose }: { words: StatWord[]; onClose: () => void }) {
  const [shown, setShown] = useState(MODAL_BATCH);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => closeRef.current?.focus(), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || shown >= words.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown((n) => Math.min(words.length, n + MODAL_BATCH));
        }
      },
      { root: scrollRef.current, rootMargin: "0px 0px 400px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [shown, words.length]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={scrollRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="all-best-words-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="all-best-words-heading">Best words</h2>
          <button
            ref={closeRef}
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close best words"
          >
            ×
          </button>
        </div>
        <BestWordList words={words.slice(0, shown)} />
        {shown < words.length && <div ref={sentinelRef} className="stats__sentinel" aria-hidden="true" />}
      </div>
    </div>
  );
}

function ByMode({ stats }: { stats: PlayerStats }) {
  return (
    <section className="stats__section" aria-labelledby="stats-modes">
      <h2 className="stats__heading" id="stats-modes">
        By mode
      </h2>
      <table className="stats__table">
        <thead>
          <tr>
            <th scope="col">Mode</th>
            <th scope="col">Puzzles</th>
            <th scope="col">Average</th>
            <th scope="col">Best</th>
          </tr>
        </thead>
        <tbody>
          {stats.modes.map((row) => (
            <tr key={row.mode}>
              <th scope="row">{MODE_LABELS[row.mode]}</th>
              <td>{row.puzzles}</td>
              <td>{row.average === null ? "–" : formatTotal(row.average)}</td>
              <td>{row.best === null ? "–" : formatTotal(row.best)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="stats__footnote">Average and best are daily totals of finished puzzles.</p>
    </section>
  );
}

function Achievements({ statuses }: { statuses: AchievementStatus[] }) {
  const earned = statuses.filter((status) => status.earnedOn).length;
  const completed = Math.round((100 * earned) / statuses.length);
  return (
    <section className="stats__section" aria-labelledby="stats-achievements">
      <h2 className="stats__heading" id="stats-achievements">
        Achievements
        <span className="stats__heading-note">
          {earned} of {statuses.length} · {completed}% completed
        </span>
      </h2>
      {ACHIEVEMENT_GROUPS.map((group) => {
        const inGroup = statuses.filter((status) => status.achievement.group === group);
        // A group can be empty on a host that leaves its badges off (see
        // `viaSuggestions` in game/achievements.ts).
        if (inGroup.length === 0) return null;
        return (
          <div className="stats__group" key={group}>
            <h3 className="stats__group-heading">{group}</h3>
            <ul className="stats__achievements">
              {inGroup.map((status) => (
                <AchievementCard status={status} key={status.achievement.id} />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function AchievementCard({ status }: { status: AchievementStatus }) {
  const { achievement, earnedOn, progress } = status;
  const held = Boolean(earnedOn);
  const share = earnedShareLabel(achievement.id, undefined, held);
  const onlyYou = soleHolder(achievement.id, undefined, held)?.self ?? false;
  return (
    <li className={`stats__achievement${earnedOn ? " stats__achievement--earned" : ""}`}>
      <span className="stats__achievement-icon" aria-hidden="true">
        {achievement.icon}
      </span>
      <span className="stats__achievement-body">
        <span className="stats__achievement-title">{achievement.title}</span>
        <span className="stats__achievement-text">{achievement.description}</span>
        {earnedOn ? (
          <span className="stats__achievement-meta">Earned {formatDateLabel(earnedOn)}</span>
        ) : progress ? (
          <span className="stats__achievement-meta">
            <span className="stats__progress" aria-hidden="true">
              <span
                className="stats__progress-fill"
                style={{ width: `${Math.min(100, (progress.current / progress.target) * 100)}%` }}
              />
            </span>
            {progress.current} / {progress.target}
          </span>
        ) : (
          <span className="stats__achievement-meta">Locked</span>
        )}
        {share && (
          <span className={`stats__achievement-share${onlyYou ? " stats__achievement-share--you" : ""}`}>
            {share}
          </span>
        )}
      </span>
    </li>
  );
}
