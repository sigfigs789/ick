import { formatRarityScore, rarityForZipf } from "../game/dictionary";
import type { LiveFoldNotice } from "../game/liveFoldRescore";

interface Props {
  date: string;
  notices: readonly LiveFoldNotice[];
  onDismiss: () => void;
}

/**
 * The bubble over the guess log when a word the player banked on this puzzle
 * had its fold rejected live at /folded-live.
 *
 * Their word's score just moved without them doing anything, and a number that
 * changes on its own reads as a bug -- so it says which word, what it had been
 * mistaken for, and that it now scores as itself. Shown on this puzzle only,
 * until it is closed.
 */
export function FoldedLiveNotice({ date, notices, onDismiss }: Props) {
  if (notices.length === 0) return null;
  return (
    <div className="de-prefix-hint folded-live-notice" role="status">
      <div className="de-prefix-hint__copy">
        {notices.map((notice) => (
          <p key={notice.word} className="folded-live-notice__line">
            <strong>“{notice.word}”</strong> was incorrectly scored as its common form{" "}
            <strong>“{notice.base}”</strong>. It now scores as is —{" "}
            {formatRarityScore(notice.zipf, date)} {rarityForZipf(notice.zipf, date)}.
          </p>
        ))}
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
