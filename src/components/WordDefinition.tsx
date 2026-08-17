import { useState } from "react";
import { fetchDefinition, type Definition } from "../game/definitions";

interface Props {
  /** The word to define -- here, the drop's best-possible word. */
  word: string;
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; definition: Definition | null }
  | { status: "error" };

/** A small ⓘ button beside a word that reveals its definition inline, fetched
 * on first open from Datamuse and then kept for the rest of the session. */
export function WordDefinition({ word }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // Only fetch once; a reopen just re-reveals what we already have.
    if (state.status === "loaded" || state.status === "loading") return;
    setState({ status: "loading" });
    try {
      const definition = await fetchDefinition(word);
      setState({ status: "loaded", definition });
    } catch {
      setState({ status: "error" });
    }
  }

  const panelId = `word-definition-${word}`;

  return (
    <span className="word-definition">
      <button
        type="button"
        className="word-definition__toggle"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? `Hide definition of ${word}` : `Show definition of ${word}`}
        title={`What does "${word}" mean?`}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
          <line x1="12" y1="11" x2="12" y2="16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="7.5" r="1.25" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <span className="word-definition__panel" id={panelId} role="status">
          {state.status === "loading" && "Looking it up…"}
          {state.status === "error" && "Couldn't load the definition — check your connection."}
          {state.status === "loaded" &&
            (state.definition ? (
              <>
                {state.definition.partOfSpeech && (
                  <em className="word-definition__pos">{state.definition.partOfSpeech}</em>
                )}
                {state.definition.partOfSpeech ? " " : ""}
                {state.definition.text}
              </>
            ) : (
              "No definition found for this word."
            ))}
        </span>
      )}
    </span>
  );
}
