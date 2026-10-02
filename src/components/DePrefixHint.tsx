import { useState } from "react";
import { dePrefixFolds } from "../game/dictionary";
import type { GameMode } from "../game/mode";
import { CommonFormModal } from "./CommonFormModal";
import { foldHintEligible } from "../game/foldHint";

/** Remembered once the player has closed the notice or opened its More info. */
const SEEN_KEY = "ick:de-prefix-hint";

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Private mode: the notice comes back next visit, which is harmless.
  }
}

interface Props {
  /** What is in the input box right now. */
  value: string;
  date?: string;
  mode?: GameMode;
}

/**
 * The notice that "de-" folds from DE_PREFIX_START, shown above the input the
 * first time a Standard player starts typing a word that opens with it.
 *
 * Shown at the moment it applies rather than as an announcement, because the
 * change is invisible until it costs a word points: "dechunked" scoring as
 * "chunk" reads as a bug to a player who last saw it as a Legend. It stays
 * until the player closes it or opens More info, which is the Common forms
 * explainer the "Scored as its common form" note opens, with "de-" now in its
 * prefix list.
 */
export function DePrefixHint({ value, date, mode }: Props) {
  // A new player gets FoldHint instead: the change is news only to someone who
  // saw these words score the old way, and the two bubbles share one spot.
  const [dismissed, setDismissed] = useState(() => seen() || foldHintEligible());
  const [explaining, setExplaining] = useState(false);

  const show =
    !dismissed && value.trim().toLowerCase().startsWith("de") && dePrefixFolds(date, mode);

  function dismiss() {
    markSeen();
    setDismissed(true);
  }

  return (
    <>
      {show && (
        <div className="de-prefix-hint" role="status">
          <p className="de-prefix-hint__copy">
            <strong>“de”</strong> as a prefix will now rescore words to their
            common form.{" "}
            <button
              type="button"
              className="common-form__link"
              onClick={() => {
                dismiss();
                setExplaining(true);
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
      <CommonFormModal open={explaining} date={date} onClose={() => setExplaining(false)} />
    </>
  );
}
