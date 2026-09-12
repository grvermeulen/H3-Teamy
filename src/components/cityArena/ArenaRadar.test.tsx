import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_RADAR_SNAPSHOT } from "@/lib/cityArena/render/radar";
import ArenaRadar from "./ArenaRadar";

describe("ArenaRadar", () => {
  it("owns a labelled 90 px canvas and an accessible summary", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<ArenaRadar snapshot={EMPTY_RADAR_SNAPSHOT} />);
    expect(screen.getByLabelText("Radar")).toHaveAttribute("width", "90");
    expect(
      screen.getByText("Radar: 0 politie, 0 pickups, 0 tanks"),
    ).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
