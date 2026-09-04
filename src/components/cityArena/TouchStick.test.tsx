import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStick } from "@/lib/cityArena/input/touchStick";
import TouchStick from "./TouchStick";

describe("TouchStick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the base and knob where the finger lands and reports vectors until release", () => {
    const onVector = vi.fn();
    render(<TouchStick stick={createStick()} onVector={onVector} />);
    const surface = screen.getByTestId("touch-stick-surface");
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 50, clientY: 60 });
    expect(screen.getByTestId("touch-stick-base").getAttribute("cx")).toBe(
      "50",
    );
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 98, clientY: 60 });
    expect(onVector).toHaveBeenLastCalledWith([1, 0]);
    expect(screen.getByTestId("touch-stick-knob").getAttribute("cx")).toBe(
      "98",
    );
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(onVector).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId("touch-stick-base")).toBeNull();
  });

  it("keeps the stick with the first pointer when a second pointer touches down", () => {
    const onVector = vi.fn();
    render(<TouchStick stick={createStick()} onVector={onVector} />);
    const surface = screen.getByTestId("touch-stick-surface");

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 50, clientY: 60 });
    fireEvent.pointerDown(surface, {
      pointerId: 2,
      clientX: 200,
      clientY: 200,
    });
    expect(screen.getByTestId("touch-stick-base").getAttribute("cx")).toBe(
      "50",
    );

    fireEvent.pointerMove(surface, {
      pointerId: 2,
      clientX: 250,
      clientY: 200,
    });
    expect(onVector).not.toHaveBeenCalled();

    fireEvent.pointerUp(surface, { pointerId: 2 });
    expect(screen.getByTestId("touch-stick-base")).toBeInTheDocument();

    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 98, clientY: 60 });
    expect(onVector).toHaveBeenLastCalledWith([1, 0]);
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(onVector).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId("touch-stick-base")).toBeNull();
  });
});
