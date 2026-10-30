interface Props {
  words: readonly string[];
  /** The player's first accepted word, which unlocks "In the dictionary". */
  firstAcceptance: boolean;
  onDismiss: () => void;
}

/** "“a”", "“a” and “b”", "“a”, “b” and “c”". */
function wordList(words: readonly string[]): string {
  const quoted = words.map((word) => `“${word}”`);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/**
 * A thank-you over the puzzle when a word the player suggested has been
 * accepted into the dictionary (see game/suggestions.ts). Stays until it is
 * closed, like the fold notice beside it, so it is not missed by a player who
 * looked away as the page opened.
 */
export function SuggestionAcceptedNotice({ words, firstAcceptance, onDismiss }: Props) {
  if (words.length === 0) return null;
  const several = words.length > 1;
  return (
    <div className="de-prefix-hint suggestion-accepted" role="status">
      <span className="suggestion-accepted__icon" aria-hidden="true">
        🎉
      </span>
      <div className="de-prefix-hint__copy">
        <p className="suggestion-accepted__line">
          {several ? "Your suggested words " : "Your suggested word "}
          <strong>{wordList(words)}</strong> {several ? "were" : "was"} added to the dictionary so
          everybody can play {several ? "them" : "it"} now! Thank you for helping grow the dictionary!
        </p>
        {firstAcceptance && (
          <p className="suggestion-accepted__line suggestion-accepted__achievement">
            Achievement unlocked: 📖 In the dictionary.
          </p>
        )}
      </div>
      <button
        type="button"
        className="de-prefix-hint__close"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
