import { useState } from "react";
import { copyText } from "../clipboard";
import { buildShareText } from "../game/share";
import { loadReveal } from "../game/reveal";
import { loadShowName } from "../game/shareName";
import { drawShareName } from "./shareNameDraw";
import { loadPlayerId, selfName } from "../game/player";
import { modeForDate, type GameMode } from "../game/mode";
import { trackResultCopied } from "../analytics";
import type { AcceptedWord, StreakState } from "../game/types";

interface Props {
  date: string;
  drop: string;
  words: AcceptedWord[];
  streak: StreakState;
  isToday: boolean;
  mode?: GameMode;
  /** After the copy: the page opens the share panel and scrolls to it. */
  onShared?: () => void;
  /**
   * Wiggle to ask for a share, after a great finish (see
   * game/shareNudgeTest.ts). Stops for good once this button has copied.
   */
  nudge?: boolean;
}

/**
 * Share from the top of the guess log, on the play screen (see App.tsx).
 * One tap copies the result and opens the share panel below, which shows what was copied and the choices behind it.
 *
 * Copies exactly what the panel's own Share button would: the text is built at
 * the moment of the tap from the same saved choices the panel reads and writes
 * (answers shown, username on or off), so the two can never disagree.
 */
export function QuickShareButton({ date, drop, words, streak, isToday, mode, onShared, nudge = false }: Props) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  async function share() {
    const playerId = loadPlayerId();
    drawShareName(date);
    const playerName = playerId && loadShowName() ? selfName(playerId) : null;
    const text = buildShareText(date, drop, words, {
      reveal: loadReveal(),
      streak: streak.currentStreak,
      playerName,
      isToday,
      mode,
      source: "share",
    });
    await copyText(text);
    setCopied(true);
    setShared(true);
    trackResultCopied(mode ?? modeForDate(date));
    onShared?.();
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      className={nudge && !shared ? "quick-share quick-share--nudge" : "quick-share"}
      onClick={() => void share()}
      aria-live="polite"
    >
      {copied ? "Copied!" : "Share"}
    </button>
  );
}
