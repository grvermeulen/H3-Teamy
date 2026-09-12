import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_RADAR_SNAPSHOT } from "@/lib/cityArena/render/radar";
import ArenaRadar from "./ArenaRadar";

describe("ArenaRadar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("owns a labelled 90 px canvas and an accessible summary", () => {
    render(<ArenaRadar snapshot={EMPTY_RADAR_SNAPSHOT} />);
    expect(screen.getByLabelText("Radar")).toHaveAttribute("width", "90");
    expect(
      screen.getByText("Radar: 0 politie, 0 items, 0 tanks"),
    ).toBeInTheDocument();
  });
});
