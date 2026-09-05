import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ArenaTouchButtons from "./ArenaTouchButtons";

describe("ArenaTouchButtons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("reports held buttons and releases them on pointer up", () => {
    const onButton = vi.fn();
    render(<ArenaTouchButtons inVehicle={false} onButton={onButton} />);
    const fire = screen.getByRole("button", { name: "Schieten" });
    fireEvent.pointerDown(fire, { pointerId: 1 });
    expect(onButton).toHaveBeenLastCalledWith("fire", true);
    fireEvent.pointerUp(fire, { pointerId: 1 });
    expect(onButton).toHaveBeenLastCalledWith("fire", false);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Wapen" }), {
      pointerId: 2,
    });
    expect(onButton).toHaveBeenLastCalledWith("weaponNext", true);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Instappen" }), {
      pointerId: 3,
    });
    expect(onButton).toHaveBeenLastCalledWith("enter", true);
  });

  it("labels the car button Uitstappen while driving", () => {
    render(<ArenaTouchButtons inVehicle onButton={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Uitstappen" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Instappen" })).toBeNull();
  });
});
