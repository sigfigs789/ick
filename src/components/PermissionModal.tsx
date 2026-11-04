import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  /** The permission that was refused, e.g. "clipboard". */
  permission: string;
  /** Try the action again once the reader has changed the setting. */
  onRetry: () => void;
  onClose: () => void;
}

/**
 * Shown when a browser permission the app needs has been refused.
 *
 * A popup rather than inline copy: the base page stays free of permission
 * chatter, and the reader only hears about it at the moment it matters,
 * with a direct way to fix it.
 */
export function PermissionModal({ open, permission, onRetry, onClose }: Props) {
  const ctaRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) ctaRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="permission-heading">Allow {permission} access</h2>
        </div>
        <p className="modal__copy">
          Your browser blocked {permission} access for this site. Click the
          site settings icon next to the address bar, set{" "}
          <strong>{permission}</strong> to <strong>Allow</strong>, then try
          again.
        </p>
        <div className="reveal-modal__actions">
          <button type="button" className="reveal-modal__cancel" onClick={onClose}>
            Not now
          </button>
          <button
            ref={ctaRef}
            type="button"
            className="reveal-modal__confirm"
            onClick={onRetry}
          >
            I've allowed it — try again
          </button>
        </div>
      </div>
    </div>
  );
}
