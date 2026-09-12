import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

function Dialog({
  onClose,
  enabled = true,
}: {
  onClose: () => void;
  enabled?: boolean;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(ref, onClose, enabled);
  return (
    <div ref={ref} role="dialog" tabIndex={-1}>
      <button type="button">Eerste</button>
      <button type="button">Laatste</button>
    </div>
  );
}

describe("useDialogFocusTrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("closes on Escape and wraps Tab between the first and last control", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    screen.getByText("Laatste").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("Eerste"));
    fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps focus inside on Shift+Tab pressed right after opening", () => {
    render(<Dialog onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("Laatste"));
  });

  it("wraps Tab to the first control when the container itself still has focus", () => {
    render(<Dialog onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("Eerste"));
  });

  it("restores focus to the previously focused trigger once the dialog unmounts", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<Dialog onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    unmount();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it("stands down while disabled: neither Escape nor Tab is handled", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} enabled={false} />);
    screen.getByText("Laatste").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("Laatste"));
    fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
