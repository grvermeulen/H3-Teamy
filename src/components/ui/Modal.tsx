"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
};

/**
 * Accessible modal that reuses the existing `.modalOverlay` / `.modalContent`
 * styling. Adds Esc-to-close, click-outside-to-close, body scroll lock and a
 * standard close button so existing hand-rolled modals can collapse onto a
 * single primitive.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  ariaLabel,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.body.classList.add("modal-open");
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  function onOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current) onClose();
  }

  return (
    <div
      ref={overlayRef}
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : ariaLabel}
      onClick={onOverlayClick}
    >
      <div className="modalContent">
        <div className="modalHeader">
          <h2 className="modalTitle" style={{ fontSize: 18, margin: 0 }}>
            {title}
          </h2>
          <button
            type="button"
            className="modalCloseBtn"
            onClick={onClose}
            aria-label="Sluiten"
          >
            ✕
          </button>
        </div>
        <div className="modalBody">{children}</div>
      </div>
    </div>
  );
}
