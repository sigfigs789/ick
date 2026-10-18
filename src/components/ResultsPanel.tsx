import { Fragment, useId, useState } from "react";
import { buildShareText, type RevealMode } from "../game/share";
import { RainbowWord } from "./RainbowWord";
import { MODE_LABELS, modeForDate } from "../game/mode";
import { loadReveal, saveReveal } from "../game/reveal";
import { loadShowName, saveShowName } from "../game/shareName";
import { loadPlayerId, selfName } from "../game/player";
import { ShareButton } from "./ShareButton";
import type { AcceptedWord, StreakState } from "../game/types";
import type { GameMode } from "../game/mode";
import { trackResultCopied } from "../analytics";

interface Props {
  date: string;
  drop: string;
  words: AcceptedWord[];
  streak: StreakState;
  /**
   * Whether this is the current puzzle, which is what lets the shared result
   * call its score "Today" (see game/share.ts). Defaults to false, so an
   * archive result headed with its own date does not claim to be today's.
   */
  isToday?: boolean;
  /**
   * The rules this puzzle was played under, named on the share from
   * MODE_CHOICE_START on (see game/share.ts). Taken from the progress record
   * rather than from the switch, so an archived day shares the mode it was
   * played in.
   */
  mode?: GameMode;
  /**
   * Fold the answer and username choices and the preview behind a "Share
   * options" toggle, leaving Share itself one tap. The new play screen (see
   * game/uiVariant.ts) does this: most players share with the choices they
   * already have, and the open panel pushed the rest of the page down the
   * moment the first word landed.
   */
  collapsible?: boolean;
}

const SPOILER_LABEL_ID = "results-panel-reveal-label";

/**
 * Colour the mode a Freeform result names on its heading (see game/share.ts).
 *
 * Done here rather than in `buildShareText` because it is a property of *this*
 * rendering and not of the share: what leaves the app is plain text, which has
 * no colour to carry. So the builder stays a pure string and the preview paints
 * one token of it.
 *
 * On the heading, where the mode has ridden since the switch shipped.
 *
 * Only Freeform is painted, and a heading without it is returned untouched --
 * which is every Standard result, and every result from before the switch
 * existed, where the heading names no mode at all.
 */
function paintMode(heading: string) {
  const at = heading.indexOf(MODE_LABELS.freeform);
  if (at === -1) return heading;
  return (
    <>
      {heading.slice(0, at)}
      <RainbowWord word={MODE_LABELS.freeform} />
      {heading.slice(at + MODE_LABELS.freeform.length)}
    </>
  );
}

// Naming answers is opt-in so shared results stay spoiler-free by default; the
// player can reveal just their rarest word ("Top") or every word ("All").
const REVEAL_OPTIONS: { value: RevealMode; label: string }[] = [
  { value: "none", label: "Hide" },
  { value: "top", label: "Top" },
  { value: "all", label: "All" },
];

export function ResultsPanel({
  date,
  drop,
  words,
  streak,
  isToday = false,
  mode,
  collapsible = false,
}: Props) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsId = useId();
  const showOptions = !collapsible || optionsOpen;
  // Starts from the player's last choice, "Top" until they make one (see
  // game/reveal.ts).
  const [reveal, setRevealState] = useState<RevealMode>(loadReveal);
  const setReveal = (next: RevealMode) => {
    setRevealState(next);
    saveReveal(next);
  };
  // On until the player switches it off, and remembered once they do (see
  // game/shareName.ts).
  const [showName, setShowNameState] = useState<boolean>(loadShowName);
  const setShowName = (next: boolean) => {
    setShowNameState(next);
    saveShowName(next);
  };
  // The name the board calls this player, so the share and their row agree. A
  // browser that could not mint an id has no name, and the line is left off.
  const playerId = loadPlayerId();
  const playerName = playerId ? selfName(playerId) : null;
  const sharedResultOptions = {
    reveal,
    streak: streak.currentStreak,
    playerName: showName ? playerName : null,
    isToday,
    mode,
  };
  const shareText = buildShareText(date, drop, words, sharedResultOptions);
  const copiedShareText = buildShareText(date, drop, words, {
    ...sharedResultOptions,
    source: "share",
  });
  const [shareHeading, ...shareDetailLines] = shareText.split("\n");
  // The mode the shares report, which is the one buildShareText tags the link with.
  const sharedMode = mode ?? modeForDate(date);
  return (
    <section className="results-panel" aria-label="Share result">
      <div className="results-panel__share-actions">
        <ShareButton text={copiedShareText} onShared={() => trackResultCopied(sharedMode)} />
      </div>
      {collapsible && (
        <button
          type="button"
          className="results-panel__options-toggle"
          aria-expanded={optionsOpen}
          aria-controls={optionsId}
          onClick={() => setOptionsOpen((was) => !was)}
        >
          Share options <span aria-hidden="true">{optionsOpen ? "▴" : "▾"}</span>
        </button>
      )}
      {showOptions && (
        <div id={optionsId}>
          {/* A radiogroup rather than a fieldset: the label sits on the same
              row as the options, and a <legend> can't join a flex row. */}
          <div
            className="results-panel__spoiler-toggle"
            role="radiogroup"
            aria-labelledby={SPOILER_LABEL_ID}
          >
            <span id={SPOILER_LABEL_ID}>Show answers</span>
            <div className="results-panel__spoiler-options">
              {REVEAL_OPTIONS.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name="results-panel-reveal"
                    value={option.value}
                    checked={reveal === option.value}
                    onChange={() => setReveal(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
          {playerName && (
            <label className="results-panel__spoiler-toggle results-panel__name-toggle">
              <input
                type="checkbox"
                checked={showName}
                onChange={(event) => setShowName(event.target.checked)}
              />
              Show username
            </label>
          )}
          <pre className="results-panel__preview" aria-hidden="true">
            <strong>{paintMode(shareHeading)}</strong>
            {shareDetailLines.length > 0 && "\n"}
            {shareDetailLines.map((line, index) => (
              <Fragment key={index}>
                {index > 0 && "\n"}
                {line}
              </Fragment>
            ))}
          </pre>
        </div>
      )}
    </section>
  );
}
