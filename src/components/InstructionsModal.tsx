import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { trackFeedbackSubmitted } from "../analytics";
import { modeIsChosen } from "../game/mode";
import { todayDateString } from "../game/date";
import { CommonFormBody } from "./CommonFormModal";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Page = "rules" | "folds";

/** Matches --ease-standard; the height tween runs in script, not CSS. */
const EASE_STANDARD = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const RESIZE_MS = 220;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function InstructionsModal({ open, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const moreInfoRef = useRef<HTMLButtonElement>(null);
  const [feedback, setFeedback] = useState("");
  const [sent, setSent] = useState(false);
  // The explainer is a page of this card, not a second sheet swapped in for
  // it. Swapping sheets replayed the open animation both ways, so closing the
  // explainer looked like How to play shutting and popping back up; one card
  // that slides between two pages and eases to each page's height reads as
  // going one step in and one step back.
  const [page, setPage] = useState<Page>("rules");
  // Whether this opening has turned a page yet. Until it has, How to play is
  // arriving with the card and gets no slide of its own.
  const [paged, setPaged] = useState(false);
  // Set on the way out of a page, read once the next one has rendered: the
  // card's height to ease from, and where How to play was scrolled to.
  const fromHeight = useRef<number | null>(null);
  const rulesScroll = useRef(0);

  const goTo = useCallback((next: Page) => {
    const card = cardRef.current;
    if (card) {
      fromHeight.current = card.getBoundingClientRect().height;
      if (next === "folds") rulesScroll.current = card.scrollTop;
    }
    setPage(next);
    setPaged(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setPage("rules");
      setPaged(false);
      rulesScroll.current = 0;
    }
  }, [open]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  // Layout rather than a plain effect so the new page never paints at its own
  // height, scrolled to the top, before the tween and the restore take over.
  useLayoutEffect(() => {
    const card = cardRef.current;
    const from = fromHeight.current;
    fromHeight.current = null;
    if (!card || from === null) return;

    // Back where the player left How to play, focus included; the explainer
    // starts from its top.
    const scrollTop = page === "rules" ? rulesScroll.current : 0;
    card.scrollTop = scrollTop;
    (page === "rules" ? moreInfoRef : backRef).current?.focus({
      preventScroll: true,
    });

    const to = card.getBoundingClientRect().height;
    if (Math.abs(from - to) < 1 || prefersReducedMotion() || !card.animate) {
      return;
    }
    card.classList.add("modal--resizing");
    const tween = card.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: RESIZE_MS, easing: EASE_STANDARD },
    );
    const settle = () => {
      card.classList.remove("modal--resizing");
      // A card shorter mid-tween than at rest can clamp the restored scroll.
      card.scrollTop = scrollTop;
    };
    tween.onfinish = settle;
    tween.oncancel = settle;
    return () => tween.cancel();
  }, [page]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // One step back from the explainer, as its back button does.
      if (page === "folds") goTo("rules");
      else onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, page, onClose, goTo]);

  if (!open) return null;

  function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = feedback.trim();
    if (!note) return;
    trackFeedbackSubmitted(note);
    setFeedback("");
    setSent(true);
  }

  const closeButton = (
    <button
      ref={closeRef}
      type="button"
      className="modal__close"
      onClick={onClose}
      aria-label="Close instructions"
    >
      ×
    </button>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        className="modal modal--paged"
        role="dialog"
        aria-modal="true"
        aria-labelledby={
          page === "folds" ? "common-form-heading" : "instructions-heading"
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* Keyed so each page mounts fresh and plays its slide. Forward comes
            in from the right, back from the left, as a drill-in does. */}
        <div
          key={page}
          className={
            page === "folds"
              ? "modal__page modal__page--forward"
              : paged
                ? "modal__page modal__page--back"
                : "modal__page"
          }
        >
          {page === "folds" ? (
            <>
              <div className="modal__header modal__header--paged">
                <button
                  ref={backRef}
                  type="button"
                  className="modal__close modal__back"
                  onClick={() => goTo("rules")}
                  aria-label="Back to How to play"
                >
                  ‹
                </button>
                <h2 id="common-form-heading">Common forms</h2>
                {closeButton}
              </div>
              {/* Standard's lists whatever the player's own mode: the
                  link that opened this is Standard's line. */}
              <CommonFormBody
                date={todayDateString()}
                mode="standard"
                onLeave={onClose}
              />
            </>
          ) : (
            <>
              <div className="modal__header">
                <h2 id="instructions-heading">How to play Word<span className="app__wordmark-ink">Ink</span></h2>
                {closeButton}
              </div>
            <p className="modal__copy">
              Word<span className="app__wordmark-ink">Ink</span> gives everyone the same daily drop—say, “<span className="app__wordmark-ink">INK</span>”. Find the rarest
              English word you can that contains it, like th<strong className="app__wordmark-ink">INK</strong>, wr
              <strong className="app__wordmark-ink">INK</strong>le, or <strong className="app__wordmark-ink">INK</strong>ling.
            </p>
            {/* The two modes, once there are two. Short on purpose: this sheet is
                the first thing a new player sees, and the difference between them is
                one sentence each -- whether a word is priced as itself or as the
                common word it is a form of. Everything else about the two is the
                same game, so everything above this still applies to both.

                Only from MODE_CHOICE_START. Before it there is one set of rules and
                a section headed "Standard" would be naming a choice nobody has. */}
            {modeIsChosen(todayDateString()) && (
              <div className="modal__modes">
                <h3 className="modal__modes-heading">Two ways to play</h3>
                <p className="modal__copy">
                  <strong>Standard</strong> — words score as their common form:
                  “plays” counts as “play”.{" "}
                  <button
                    ref={moreInfoRef}
                    type="button"
                    className="common-form__link"
                    onClick={() => goTo("folds")}
                    aria-label="More info on how common forms are scored"
                  >
                    More info
                  </button>
                </p>
                <p className="modal__copy">
                  <strong>Freeform</strong> — every word is scored on its own
                  frequency, so “plays” is worth what “plays” is worth.
                </p>
              </div>
            )}
            <p className="modal__rarity-note">
              Rarity scores reflect how often a word appears across books, news,
              movies, websites, and social media—not how complex it is. Values are
              computed using Zipf’s law. The highest ranks are Mythic at 9.5+ and
              Legend at 9.9+.
            </p>
            <form
              className="word-suggestion feedback-form"
              onSubmit={submitFeedback}
            >
              <div className="word-suggestion__row feedback-form__row">
                <textarea
                  id="game-feedback"
                  className="feedback-form__input"
                  aria-label="Share feedback or leave a suggestion"
                  value={feedback}
                  onChange={(event) => {
                    setFeedback(event.target.value);
                    setSent(false);
                  }}
                  placeholder="Share feedback"
                  rows={2}
                />
                <button type="submit" disabled={!feedback.trim()}>
                  Send
                </button>
              </div>
              {/* role="status" so the confirmation is announced and not only seen:
                  the box empties either way, and an empty box is not an answer.

                  No link to /feedback from here, deliberately. The word queue is
                  offered to whoever suggests a word, because a queue of words is
                  everybody's; a note is something one player wrote to us, and
                  pointing the next player at the pile of them is a different thing
                  to publish. See src/routes.ts. */}
              {sent && (
                <p className="word-suggestion__thanks" role="status">
                  Thanks for the feedback!
                </p>
              )}
            </form>
            <p className="modal__signoff">
              Made by one person, for fun. Thanks for playing. 🙂
            </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
