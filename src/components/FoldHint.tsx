import { useState } from "react";
import type { GameMode } from "../game/mode";
import { foldHintEligible, markFoldHintSeen, typedFoldAffix } from "../game/foldHint";
import { CommonFormModal } from "./CommonFormModal";

interface Props {
  /** What is in the input box right now. */
  value: string;
  date?: string;
  mode?: GameMode;
}

/**
 * The notice that words built with a prefix or suffix score as their more
 * common form, shown above the input to a new Standard player as soon as what
 * they are typing has one.
 *
 * Shown while typing rather than after, because the score is the surprise: a
 * player who reaches for "uncreatively" expecting a Legend and gets
 * "creative" reads it as a bug unless something said so first. It stays until
 * the player closes it or opens More info, the Common forms explainer.
 */
export function FoldHint({ value, date, mode }: Props) {
  const [eligible, setEligible] = useState(foldHintEligible);
  const [explaining, setExplaining] = useState(false);

  const affix = eligible ? typedFoldAffix(value, date, mode) : undefined;

  function dismiss() {
    markFoldHintSeen();
    setEligible(false);
  }

  return (
    <>
      {affix && (
        <div className="de-prefix-hint fold-hint" role="status">
          <p className="de-prefix-hint__copy">
            Words {affix.startsWith("-") ? "ending in" : "starting with"}{" "}
            <strong>“{affix}”</strong> score as their more common form.{" "}
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
