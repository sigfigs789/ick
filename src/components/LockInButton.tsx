interface Props {
  onLockIn: () => void;
}

export function LockInButton({ onLockIn }: Props) {
  return (
    <button type="button" className="lock-in-button" onClick={onLockIn}>
      Lock in answers
    </button>
  );
}
