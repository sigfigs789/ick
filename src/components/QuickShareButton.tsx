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
import { shareFlamesClass, type FlameTier } from "../game/shareFlamesTest";
import { ShareFlames } from "./ShareFlames";

interface Props {
  date: string;
  drop: string;
  words: AcceptedWord[];
  streak: StreakState;
  isToday: boolean;
  mode?: GameMode;
  /** After the copy: the page opens the share panel and scrolls to it. */
  onShared?: () => void;
  /** The tier the button burns in, or none (see game/shareFlamesTest.ts). */
  flames?: FlameTier | null;
}

/**
 * Share from the top of the guess log, on the play screen (see App.tsx).
 * One tap copies the result and opens the share panel below, which shows what was copied and the choices behind it.
 *
 * Copies exactly what the panel's own Share button would: the text is built at
 * the moment of the tap from the same saved choices the panel reads and writes
 * (answers shown, username on or off), so the two can never disagree.
 */
export function QuickShareButton({ date, drop, words, streak, isToday, mode, onShared, flames = null }: Props) {
  const [copied, setCopied] = useState(false);

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
    trackResultCopied(mode ?? modeForDate(date));
    onShared?.();
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      className={`quick-share${shareFlamesClass(flames)}`}
      onClick={() => void share()}
      aria-live="polite"
    >
      {flames && <ShareFlames />}
      {copied ? "Copied!" : "Share"}
    </button>
  );
}
