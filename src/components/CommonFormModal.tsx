import { useEffect, useRef } from "react";
import { foldAffixGroups } from "../game/dictionary";
import type { GameMode } from "../game/mode";
import { takesPlayerMessages } from "../game/playerMessages";
import { navigate } from "../routes";

interface Props {
  /** The word whose note was tapped, and the form it was scored as. */
  word?: { word: string; base: string };
  /**
   * Open without a word: the How to play sheet's "More info", where the
   * question is the rule itself rather than one word's score.
   */
  open?: boolean;
  /** The puzzle being played, which decides which affixes folded that day. */
  date?: string;
  onClose: () => void;
}

/**
 * What "scored as its common form" means, behind the note's "More info".
 *
 * The note names the form and nothing else, which answers "why is the badge
 * low" but not the question a player asks next: what did the game think my
 * word was made of? So this leads with their own word and the form it folded
 * to, then the affixes the fold can read through -- the note's claim,
 * generalised, rather than a scoring essay the note happens to link to.
 *
 * The lists come from `foldAffixGroups`, which reads the same date-scoped
 * tables the scoring does: on an archived August puzzle the prefix list is the
 * longer one that puzzle was actually scored with.
 */
export function CommonFormModal({
  word,
  open = false,
  date,
  onClose,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const visible = open || word !== undefined;

  useEffect(() => {
    if (visible) closeRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="common-form-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="common-form-heading">Common forms</h2>
          <button
            ref={closeRef}
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close common forms"
          >
            ×
          </button>
        </div>

        <CommonFormBody word={word} date={date} onLeave={onClose} />
      </div>
    </div>
  );
}

interface BodyProps {
  word?: { word: string; base: string };
  date?: string;
  /** Whose lists to show; the player's own mode when left out. */
  mode?: GameMode;
  /** Called before the feedback link navigates away, to put the sheet away. */
  onLeave: () => void;
}

/**
 * The explainer without its sheet, so How to play can show it as a page of
 * its own card rather than a second sheet swapped in over the first.
 */
export function CommonFormBody({ word, date, mode, onLeave }: BodyProps) {
  const groups = foldAffixGroups(date, mode);

  return (
    <>
      {/* The player's own word first. The general rule is what the rest of
          the panel is for, but the question that opened it was about one
          word, and answering that one before explaining the rule is the
          difference between an answer and a reference page.

          Opened from How to play there is no word yet, so the same claim is
          made about an example instead. */}
      {word ? (
        <>
          <p className="common-form__pair">
            <span className="common-form__word">{word.word}</span>
            <span className="common-form__arrow" aria-hidden="true">
              →
            </span>
            <span className="common-form__word">{word.base}</span>
          </p>
          {/* True in both directions: "abaci" folds up to "abacus" on the
              archived puzzles that still capped at a longer form. */}
          <p className="modal__copy">
            “{word.word}” scores as “{word.base}”, its more common form.
          </p>
        </>
      ) : (
        <p className="modal__copy">
          In Standard, a familiar word in an unfamiliar shape isn’t scored as
          a rarer word.
        </p>
      )}

      <ul className="common-form__groups">
        {groups.map((group) => (
          <li key={group.title} className="common-form__group">
            <h3 className="common-form__group-title">{group.title}</h3>
            <p className="common-form__affixes">
              {/* Commas rather than chips: the measurement row is 29 entries
                  long, and a grid of 29 pills is a wall where a sentence is
                  a list you can stop reading.

                  One span each all the same, because a hyphen is a break
                  opportunity and a phone was splitting "-cked" across two
                  lines as "-" and "cked" -- an affix broken in half is
                  unreadable as the thing it is. The comma is inside the
                  span, so the break lands after it. */}
              {group.affixes.map((affix, index) => (
                <span key={affix} className="common-form__affix">
                  {affix}
                  {index < group.affixes.length - 1 ? "," : ""}
                </span>
              ))}
            </p>
            <p className="common-form__example">
              {group.example.word} → {group.example.base}
            </p>
          </li>
        ))}
      </ul>

      {/* The way out of a fold a player thinks is wrong. Every one of these
          is reviewable by hand, and the note is the moment someone has a
          specific one in mind -- the same argument that puts the word
          suggestion box inside the word rules panel. */}
      {takesPlayerMessages() && (
        <p className="modal__copy modal__signoff">
          {word ? "Think this one got the wrong form?" : "Think a word got the wrong form?"}{" "}
          <button
            type="button"
            className="common-form__link"
            onClick={() => {
              onLeave();
              navigate("feedback");
            }}
          >
            Tell me about it
          </button>{" "}
          — every fold is reviewable.
        </p>
      )}
    </>
  );
}
