"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";

/** Selector for elements the focus trap is allowed to land on when wrapping Tab. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focuses the dialog on mount, keeps Tab inside it, closes on Escape and restores focus on unmount. */
export function useDialogFocusTrap(
  dialogRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
): void {
  useLayoutEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [dialogRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === "Escape" || event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const nodes = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ];
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      // The dialog container itself is a boundary too: it holds focus right after opening
      // (before any control has been tabbed to), so neither `first` nor `last` matches it.
      const onContainer = document.activeElement === dialogRef.current;
      if (!event.shiftKey && (onContainer || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      } else if (
        event.shiftKey &&
        (onContainer || document.activeElement === first)
      ) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [dialogRef, onClose]);
}
