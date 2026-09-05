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

  it("holds via keyboard Space, ignoring repeat events, and releases on key up", () => {
    const onButton = vi.fn();
    render(<ArenaTouchButtons inVehicle={false} onButton={onButton} />);
    const fire = screen.getByRole("button", { name: "Schieten" });

    fireEvent.keyDown(fire, { key: " " });
    fireEvent.keyDown(fire, { key: " ", repeat: true });
    fireEvent.keyDown(fire, { key: " ", repeat: true });
    expect(onButton).toHaveBeenCalledTimes(1);
    expect(onButton).toHaveBeenCalledWith("fire", true);

    fireEvent.keyUp(fire, { key: " " });
    expect(onButton).toHaveBeenCalledTimes(2);
    expect(onButton).toHaveBeenLastCalledWith("fire", false);
  });

  it("holds via keyboard Enter and releases on key up", () => {
    const onButton = vi.fn();
    render(<ArenaTouchButtons inVehicle={false} onButton={onButton} />);
    const fire = screen.getByRole("button", { name: "Schieten" });

    fireEvent.keyDown(fire, { key: "Enter" });
    expect(onButton).toHaveBeenCalledTimes(1);
    expect(onButton).toHaveBeenCalledWith("fire", true);

    fireEvent.keyUp(fire, { key: "Enter" });
    expect(onButton).toHaveBeenCalledTimes(2);
    expect(onButton).toHaveBeenLastCalledWith("fire", false);
  });

  it("ignores non-activation keys", () => {
    const onButton = vi.fn();
    render(<ArenaTouchButtons inVehicle={false} onButton={onButton} />);
    const fire = screen.getByRole("button", { name: "Schieten" });

    fireEvent.keyDown(fire, { key: "Tab" });
    fireEvent.keyUp(fire, { key: "Tab" });
    expect(onButton).not.toHaveBeenCalled();
  });

  it("releases a keyboard-held button when it loses focus", () => {
    const onButton = vi.fn();
    render(<ArenaTouchButtons inVehicle={false} onButton={onButton} />);
    const fire = screen.getByRole("button", { name: "Schieten" });
    fireEvent.keyDown(fire, { key: " " });
    fireEvent.blur(fire);
    expect(onButton).toHaveBeenCalledTimes(2);
    expect(onButton).toHaveBeenLastCalledWith("fire", false);
  });
});
