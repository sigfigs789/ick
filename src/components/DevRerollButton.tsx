interface Props {
  onReroll: () => void;
  isDevPuzzle: boolean;
}

/** Dev-only control (see App.tsx -- only rendered when import.meta.env.DEV). */
export function DevRerollButton({ onReroll, isDevPuzzle }: Props) {
  return (
    <div className="dev-reroll">
      <button type="button" className="dev-reroll__button" onClick={onReroll}>
        🔀 New fragment (dev)
      </button>
      {isDevPuzzle && (
        <p className="dev-reroll__note">Preview only — not saved, doesn't affect your streak.</p>
      )}
    </div>
  );
}
