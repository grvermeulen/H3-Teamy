import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadArenaSettings, saveArenaSettings } from "@/lib/cityArena/storage";
import { ZONE_OPTIONS } from "@/lib/cityArena/constants";
import { ArenaNewGame } from "./ArenaNewGame";

describe("new arena location", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it.each(ZONE_OPTIONS)(
    "creates a room in $name only after confirmation",
    ({ key, name }) => {
      const onStart = vi.fn();
      render(<ArenaNewGame onStart={onStart} />);
      fireEvent.click(screen.getByRole("radio", { name: new RegExp(name) }));
      expect(onStart).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: `Potje openen in ${name}` }),
      );
      expect(onStart).toHaveBeenCalledExactlyOnceWith(key);
      expect(loadArenaSettings().lastZone).toBe(key);
    },
  );

  it("restores the last chosen location and preserves it when cancelling", () => {
    saveArenaSettings({ lastZone: "bennekom" });
    const onStart = vi.fn();
    const onCancel = vi.fn();
    render(<ArenaNewGame onStart={onStart} onCancel={onCancel} />);
    expect(screen.getByRole("radio", { name: /Bennekom/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /WUR-campus/ }));
    fireEvent.click(screen.getByRole("button", { name: "Annuleren" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onStart).not.toHaveBeenCalled();
    expect(loadArenaSettings().lastZone).toBe("bennekom");
  });

  it("cannot create a room when the player is not allowed to start", () => {
    const onStart = vi.fn();
    render(<ArenaNewGame onStart={onStart} disabled />);
    expect(screen.getByRole("button", { name: /Potje openen/ })).toBeDisabled();
    fireEvent.submit(
      screen.getByRole("button", { name: /Potje openen/ }).closest("form")!,
    );
    expect(onStart).not.toHaveBeenCalled();
  });
});
