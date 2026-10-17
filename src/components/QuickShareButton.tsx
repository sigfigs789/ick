import { useState } from "react";
import { copyText } from "../clipboard";
import { buildShareText } from "../game/share";
import { loadReveal } from "../game/reveal";
import { loadShowName } from "../game/shareName";
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
}

/**
 * Share from the top of the guess log, on the new play screen (see
 * game/uiVariant.ts), so a player does not have to scroll to the results panel
 * to post a word they are pleased with.
 *
 * Copies exactly what the panel's own Share button would: the text is built at
 * the moment of the tap from the same saved choices the panel reads and writes
 * (answers shown, username on or off), so the two can never disagree.
 */
export function QuickShareButton({ date, drop, words, streak, isToday, mode }: Props) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const playerId = loadPlayerId();
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
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" className="quick-share" onClick={() => void share()} aria-live="polite">
      {copied ? "Copied!" : "Share"}
    </button>
  );
}
