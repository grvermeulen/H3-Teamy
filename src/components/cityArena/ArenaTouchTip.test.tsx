import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArenaTouchTip,
  LOOK_PAD_TIP,
  SINGLE_STICK_TIP,
  TWIN_STICK_TIP,
} from "./ArenaTouchTip";

describe("ArenaTouchTip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("explains the aim stick, or the buttons, and goes away on Begrepen", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <ArenaTouchTip twinStick onDismiss={onDismiss} />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(TWIN_STICK_TIP);
    rerender(<ArenaTouchTip twinStick={false} onDismiss={onDismiss} />);
    expect(screen.getByRole("note")).toHaveTextContent(SINGLE_STICK_TIP);
    fireEvent.click(screen.getByRole("button", { name: "Begrepen" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("explains the look pad, Schieten and Richten in 3D, whatever the 2D layout", () => {
    render(<ArenaTouchTip twinStick look3d onDismiss={vi.fn()} />);
    expect(screen.getByRole("note")).toHaveTextContent(LOOK_PAD_TIP);
    expect(LOOK_PAD_TIP).toContain("rond te kijken");
    expect(LOOK_PAD_TIP).toContain("Richten zoomt in");
  });
});
