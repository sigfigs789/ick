import { useState } from "react";
import { baseFormSubstitution, foldTrace, usesFreeformRules } from "../game/dictionary";
import type { GameMode } from "../game/mode";
import { foldHintEligible, markFoldHintSeen } from "../game/foldHint";
import { CommonFormModal } from "./CommonFormModal";

/**
 * The common form `word` would score as on `date`'s puzzle in `mode`, if the
 * fold would take it there. The curated check first, which is what the
 * "Scored as its common form" note reads; then the corpus, which most folds
 * reach since CORPUS_ONLY_START.
 */
function foldedBase(word: string, drop: string, date?: string, mode?: GameMode): string | undefined {
  const normalized = word.trim().toLowerCase();
  if (normalized.length < 3 || !normalized.includes(drop.toLowerCase())) return undefined;
  if (usesFreeformRules(date, mode)) return undefined;
  return (baseFormSubstitution(normalized, date) ?? foldTrace(normalized, date))?.base;
}

interface Props {
  /** What is in the input box right now. */
  value: string;
  drop: string;
  date?: string;
  mode?: GameMode;
}

/**
 * The notice that a word will be scored as its common form, shown above the
 * input to a new Standard player while the word in the box is one that folds.
 *
 * Before the word is submitted rather than after, because the score is the
 * surprise: a player who reaches for "uncreatively" expecting a Legend and
 * gets "creative" reads it as a bug unless something said so first. It stays
 * until the player closes it or opens More info, the same Common forms
 * explainer the guess log's note opens, led with their word.
 */
export function FoldHint({ value, drop, date, mode }: Props) {
  const [eligible, setEligible] = useState(foldHintEligible);
  const [explaining, setExplaining] = useState<{ word: string; base: string }>();

  const word = value.trim().toLowerCase();
  const base = eligible ? foldedBase(word, drop, date, mode) : undefined;

  function dismiss() {
    markFoldHintSeen();
    setEligible(false);
  }

  return (
    <>
      {base && (
        <div className="de-prefix-hint fold-hint" role="status">
          <p className="de-prefix-hint__copy">
            <strong>“{word}”</strong> will score as <strong>“{base}”</strong>, its
            more common form.{" "}
            <button
              type="button"
              className="common-form__link"
              onClick={() => {
                dismiss();
                setExplaining({ word, base });
              }}
            >
              More info
            </button>
          </p>
          <button
            type="button"
            className="de-prefix-hint__close"
            aria-label="Dismiss"
            // Keeps the input focused, so closing the notice does not close
            // the mobile keyboard mid-word.
            onMouseDown={(e) => e.preventDefault()}
            onClick={dismiss}
          >
            ×
          </button>
        </div>
      )}
      <CommonFormModal word={explaining} date={date} onClose={() => setExplaining(undefined)} />
    </>
  );
}
