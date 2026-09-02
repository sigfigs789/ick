import { useEffect, useState } from "react";
import type { Feedback } from "../hooks/useDailyPuzzle";
import type { RejectionReason } from "../game/types";
import { REJECTION_LEADS } from "../game/submit";

interface Props {
  feedback: Feedback | null;
  /**
   * A note about a live lookup: the in-progress verb while it runs, its past
   * tense once it answers. Rendered above the toast, so it sits directly under
   * the input with the verdict below it.
   */
  note?: string | null;
  onWordRules: () => void;
}

const VISIBLE_MS = 12000;

/**
 * The two verdicts that really do mean "we couldn't find this anywhere": the
 * curated list has no such word, or it has one a letter or two away.
 *
 * Everything else -- a proper noun, an archaic form, a word already used, a
 * guess missing the drop -- is a different answer wearing the same red toast,
 * and players read the colour rather than the sentence: every rejection was
 * landing as "not on the list". So the not-found pair keeps the red, and every
 * rejection that has something more specific to say takes the caution yellow,
 * which is the signal that the words below are worth reading.
 */
const NOT_FOUND_REASONS = new Set<RejectionReason>(["not-a-word", "check-your-spelling"]);

/**
 * A single polite live region, styled as a small toast that fades in and
 * back out. Re-announcing an identical message (e.g. the same rejection
 * twice in a row) works because `feedback.key` changes every time, forcing
 * React to treat the text as new content -- the fade is purely visual and
 * doesn't affect what's read.
 */
export function FeedbackRegion({ feedback, note, onWordRules }: Props) {
  const [shown, setShown] = useState(false);
  const [noteShown, setNoteShown] = useState(false);

  useEffect(() => {
    if (!feedback) return;
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // The note holds while the lookup is still running -- it has no verdict to
  // outlive yet. Once one lands it fades on the same window as the toast, keyed
  // off the same `feedback` change, so the two always clear together.
  useEffect(() => {
    if (!note) {
      setNoteShown(false);
      return;
    }
    setNoteShown(true);
    if (!feedback) return;
    const timer = window.setTimeout(() => setNoteShown(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [note, feedback]);

  // A note still in flight ends in an ellipsis; a settled one ("Found it!")
  // doesn't. Only the pending form gets the animated dots, so the split is just
  // that character: the stem stays a plain text node and carries the
  // announcement, and the dots are decoration the screen reader never sees.
  const pendingStem = note?.endsWith("…") ? note.slice(0, -1) : null;

  // A trailing run of zero-width spaces, sized by `feedback.key`, makes
  // consecutive identical messages (e.g. rejecting the same word twice)
  // register as new text content so screen readers re-announce them.
  const filler = feedback ? "​".repeat(feedback.key % 20) : "";

  // The lead is bolded out of the sentence it opens, so a skim carries the
  // verdict on its own. Split off `feedback.message` rather than rendered from
  // the parts, so the toast can only ever show the exact sentence the rest of
  // the game announces and reports.
  const lead = feedback?.reason ? REJECTION_LEADS[feedback.reason] : undefined;
  const rest =
    feedback && lead && feedback.message.startsWith(lead)
      ? feedback.message.slice(lead.length)
      : null;

  const specific =
    feedback?.kind === "rejected" &&
    feedback.reason !== undefined &&
    !NOT_FOUND_REASONS.has(feedback.reason);

  return (
    <>
      {note && (
        // Deliberately not role="status": the toast below is the page's single
        // status region, and aria-live alone still announces this when it changes.
        <p className={`live-note${noteShown ? " live-note--shown" : ""}`} aria-live="polite">
          {pendingStem ?? note}
          {pendingStem !== null && (
            <span className="live-note__dots" aria-hidden="true">
              <span className="live-note__dot">.</span>
              <span className="live-note__dot">.</span>
              <span className="live-note__dot">.</span>
            </span>
          )}
        </p>
      )}
      <p
        className={`feedback${feedback ? ` feedback--${feedback.kind}` : ""}${specific ? " feedback--specific" : ""}${shown ? " feedback--shown" : ""}`}
        role="status"
        aria-live="polite"
      >
        {rest !== null ? (
          <>
            <strong className="feedback__lead">{lead}</strong>
            {`${rest}${filler}`}
          </>
        ) : (
          (feedback ? `${feedback.message}${filler}` : "")
        )}
        {feedback?.kind === "rejected" && (
          <button
            type="button"
            className="feedback__more-info"
            onClick={onWordRules}
          >
            More info
          </button>
        )}
      </p>
    </>
  );
}
