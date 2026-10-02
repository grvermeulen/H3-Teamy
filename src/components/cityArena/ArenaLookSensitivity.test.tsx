import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArenaLookSensitivity } from "./ArenaLookSensitivity";

describe("ArenaLookSensitivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the factor in Dutch and reports a new one from 0.25 to 2.5", () => {
    const onChange = vi.fn();
    render(<ArenaLookSensitivity value={1.25} onChange={onChange} />);
    const slider = screen.getByLabelText("Kijkgevoeligheid");
    expect(slider).toHaveAttribute("min", "0.25");
    expect(slider).toHaveAttribute("max", "2.5");
    expect(screen.getByText("1,25×")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
