interface Props {
  enabled: boolean;
  onToggle: () => void;
}

/**
 * The sound switch lives in the how-to-play sheet rather than the header. It is
 * a setting a player touches once, if ever, and it was spending a permanent
 * corner of the one bar every screen shows to say so.
 */
export function SoundToggle({ enabled, onToggle }: Props) {
  return (
    <button
      type="button"
      className="modal__setting"
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Mute sound effects" : "Unmute sound effects"}
    >
      <span className="modal__setting-label">Sound effects</span>
      <span className="modal__setting-value" aria-hidden="true">
        {enabled ? "On" : "Off"}
      </span>
    </button>
  );
}
