import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ARENA_SETTINGS } from "@/lib/cityArena/schemas";
import { ArenaSettingsSheet } from "./ArenaSettingsSheet";

vi.mock("@/lib/cityArena/audio/radio/stations", () => {
  const stations = [
    { id: "a", name: "A FM", tracks: [] },
    { id: "b", name: "B FM", tracks: [] },
  ];
  return {
    RADIO_STATIONS: stations,
    stationById: (id: string | undefined) =>
      stations.find((station) => station.id === id) ?? stations[0] ?? null,
  };
});

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

  it("has a Radio switch and a Zender select over the dial that patch the settings", () => {
    const handlers = renderSheet();
    expect(screen.getByLabelText("Radio")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Radio"));
    expect(handlers.onChange).toHaveBeenLastCalledWith({ radio: false });
    const select = screen.getByLabelText("Zender");
    expect(select).toHaveValue("a");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(expect.arrayContaining(["A FM", "B FM"]));
    fireEvent.change(select, { target: { value: "b" } });
    expect(handlers.onChange).toHaveBeenLastCalledWith({ radioStation: "b" });
  });

  it("shows the stored station, and the first one for an id the dial does not have", () => {
    renderSheet({
      settings: { ...DEFAULT_ARENA_SETTINGS, radioStation: "b" },
    });
    expect(screen.getByLabelText("Zender")).toHaveValue("b");
    cleanup();
    renderSheet({
      settings: { ...DEFAULT_ARENA_SETTINGS, radioStation: "gone" },
    });
    expect(screen.getByLabelText("Zender")).toHaveValue("a");
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
