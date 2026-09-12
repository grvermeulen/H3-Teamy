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

  it("labels the car button Biertje at the brewery's tap, and still Uitstappen in a car", () => {
    const onButton = vi.fn();
    const { rerender } = render(
      <ArenaTouchButtons inVehicle={false} canOrderBeer onButton={onButton} />,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Biertje" }), {
      pointerId: 4,
    });
    expect(onButton).toHaveBeenLastCalledWith("enter", true);
    expect(screen.queryByRole("button", { name: "Instappen" })).toBeNull();
    rerender(<ArenaTouchButtons inVehicle canOrderBeer onButton={onButton} />);
    expect(
      screen.getByRole("button", { name: "Uitstappen" }),
    ).toBeInTheDocument();
  });

  it("labels the car button Uitstappen while driving", () => {
    render(<ArenaTouchButtons inVehicle onButton={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Uitstappen" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Instappen" })).toBeNull();
  });

  it("offers Radio as a tap in a car, and not on foot", () => {
    const onRadio = vi.fn();
    render(
      <ArenaTouchButtons inVehicle onButton={vi.fn()} onRadio={onRadio} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Radio" }));
    expect(onRadio).toHaveBeenCalledTimes(1);
    cleanup();
    render(
      <ArenaTouchButtons
        inVehicle={false}
        onButton={vi.fn()}
        onRadio={onRadio}
      />,
    );
    expect(screen.queryByRole("button", { name: "Radio" })).toBeNull();
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
