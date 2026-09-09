import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArenaTouchTip,
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
});
