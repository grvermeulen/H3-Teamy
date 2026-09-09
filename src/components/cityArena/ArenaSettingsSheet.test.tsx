import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ARENA_SETTINGS } from "@/lib/cityArena/schemas";
import { ArenaSettingsSheet } from "./ArenaSettingsSheet";

/** The sheet with defaults, overridable per test; returns the spies. */
function renderSheet(
  props: Partial<React.ComponentProps<typeof ArenaSettingsSheet>> = {},
) {
  const handlers = { onChange: vi.fn(), onLeave: vi.fn(), onClose: vi.fn() };
  render(
    <ArenaSettingsSheet
      settings={DEFAULT_ARENA_SETTINGS}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("ArenaSettingsSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("is a dialog called Menu with the four settings in Dutch", () => {
    renderSheet();
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
    expect(screen.getByLabelText("Geluid")).toBeChecked();
    expect(screen.getByLabelText("Trillen")).toBeChecked();
    expect(screen.getByLabelText("Enkele stick")).not.toBeChecked();
    expect(screen.getByLabelText("Indeling")).toHaveValue("auto");
  });

  it("reports each change as a patch", () => {
    const handlers = renderSheet();
    fireEvent.click(screen.getByLabelText("Trillen"));
    expect(handlers.onChange).toHaveBeenLastCalledWith({ vibrate: false });
    fireEvent.click(screen.getByLabelText("Geluid"));
    expect(handlers.onChange).toHaveBeenLastCalledWith({ sound: false });
    // "Enkele stick" is the inverse of the stored twin-stick flag.
    fireEvent.click(screen.getByLabelText("Enkele stick"));
    expect(handlers.onChange).toHaveBeenLastCalledWith({ twinStick: false });
    fireEvent.change(screen.getByLabelText("Indeling"), {
      target: { value: "mobile" },
    });
    expect(handlers.onChange).toHaveBeenLastCalledWith({
      forceLayout: "mobile",
    });
  });

  it("shows a forced layout, and returns it to automatic as no layout at all", () => {
    const handlers = renderSheet({
      settings: { ...DEFAULT_ARENA_SETTINGS, forceLayout: "desktop" },
    });
    expect(screen.getByLabelText("Indeling")).toHaveValue("desktop");
    fireEvent.change(screen.getByLabelText("Indeling"), {
      target: { value: "auto" },
    });
    expect(handlers.onChange).toHaveBeenLastCalledWith({
      forceLayout: undefined,
    });
  });

  it("offers the way out and the way back, and closes on Escape", () => {
    const handlers = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Potje verlaten" }));
    expect(handlers.onLeave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Verder spelen" }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(handlers.onClose).toHaveBeenCalledTimes(2);
  });
});
