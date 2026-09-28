import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOUCH_LOOK_RAD_PER_PX,
  createTouchLook,
} from "@/lib/cityArena/input/touchLook";
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

/** Sets `document.hidden`, which jsdom keeps `false`. */
function stubHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

describe("ArenaTouchButtons in 3D", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    stubHidden(false);
  });

  it("shows Richten and the round Schieten button only with a look pad", () => {
    render(
      <ArenaTouchButtons
        inVehicle={false}
        onButton={vi.fn()}
        showFire={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Richten" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Schieten" })).toBeNull();
    cleanup();
    render(
      <ArenaTouchButtons
        inVehicle={false}
        onButton={vi.fn()}
        showFire={false}
        look={createTouchLook(() => 1)}
      />,
    );
    expect(screen.getByRole("button", { name: "Richten" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Schieten" }).className,
    ).toContain("rounded-full");
  });

  it("fires while Schieten is held and stops on release", () => {
    const onButton = vi.fn();
    render(
      <ArenaTouchButtons
        inVehicle={false}
        onButton={onButton}
        look={createTouchLook(() => 1)}
      />,
    );
    const fire = screen.getByRole("button", { name: "Schieten" });
    fireEvent.pointerDown(fire, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onButton).toHaveBeenLastCalledWith("fire", true);
    fireEvent.pointerUp(fire, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onButton).toHaveBeenLastCalledWith("fire", false);
  });

  it("lets go of the trigger and the look when Schieten goes away mid-press", () => {
    const onButton = vi.fn();
    const look = createTouchLook(() => 1);
    const { rerender } = render(
      <ArenaTouchButtons inVehicle={false} onButton={onButton} look={look} />,
    );
    const fire = screen.getByRole("button", { name: "Schieten" });
    fireEvent.pointerDown(fire, { pointerId: 7, clientX: 10, clientY: 10 });
    expect(onButton).toHaveBeenLastCalledWith("fire", true);
    rerender(<ArenaTouchButtons inVehicle={false} onButton={onButton} />);
    expect(onButton).toHaveBeenCalledWith("fire", false);
    look.onDown({ pointerId: 8, clientX: 0, clientY: 0 });
    look.onMove({ pointerId: 8, clientX: 25, clientY: 0 });
    expect(look.take().yaw).toBeCloseTo(25 * TOUCH_LOOK_RAD_PER_PX);
  });

  it("takes the look over from a finger already on the pad", () => {
    const look = createTouchLook(() => 1);
    render(
      <ArenaTouchButtons inVehicle={false} onButton={vi.fn()} look={look} />,
    );
    look.onDown({ pointerId: 1, clientX: 0, clientY: 0 });
    const fire = screen.getByRole("button", { name: "Schieten" });
    fireEvent.pointerDown(fire, { pointerId: 2, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(fire, { pointerId: 2, clientX: 140, clientY: 50 });
    expect(look.take().yaw).toBeCloseTo(40 * TOUCH_LOOK_RAD_PER_PX);
  });

  it("turns the look by a drag that starts on Schieten, still firing", () => {
    const onButton = vi.fn();
    const look = createTouchLook(() => 1);
    render(
      <ArenaTouchButtons inVehicle={false} onButton={onButton} look={look} />,
    );
    const fire = screen.getByRole("button", { name: "Schieten" });
    fireEvent.pointerDown(fire, { pointerId: 4, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(fire, { pointerId: 4, clientX: 160, clientY: 50 });
    expect(look.take().yaw).toBeCloseTo(60 * TOUCH_LOOK_RAD_PER_PX);
    expect(onButton).toHaveBeenLastCalledWith("fire", true);
    fireEvent.pointerCancel(fire, { pointerId: 4, clientX: 160, clientY: 50 });
    expect(onButton).toHaveBeenLastCalledWith("fire", false);
    fireEvent.pointerMove(fire, { pointerId: 4, clientX: 200, clientY: 50 });
    expect(look.take().yaw).toBe(0);
  });

  it("flips the sights with Richten and shows it pressed", () => {
    const onButton = vi.fn();
    render(
      <ArenaTouchButtons
        inVehicle={false}
        onButton={onButton}
        look={createTouchLook(() => 1)}
      />,
    );
    const sights = screen.getByRole("button", { name: "Richten" });
    expect(sights).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(sights);
    expect(onButton).toHaveBeenLastCalledWith("ads", true);
    expect(sights).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(sights);
    expect(onButton).toHaveBeenLastCalledWith("ads", false);
    expect(sights).toHaveAttribute("aria-pressed", "false");
  });

  it("puts the sights down when they are no longer allowed, and keeps them down", () => {
    const onButton = vi.fn();
    const look = createTouchLook(() => 1);
    const { rerender } = render(
      <ArenaTouchButtons inVehicle={false} onButton={onButton} look={look} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Richten" }));
    rerender(
      <ArenaTouchButtons
        inVehicle={false}
        onButton={onButton}
        look={look}
        sightsAllowed={false}
      />,
    );
    expect(onButton).toHaveBeenLastCalledWith("ads", false);
    const sights = screen.getByRole("button", { name: "Richten" });
    expect(sights).toHaveAttribute("aria-pressed", "false");
    expect(sights).toBeDisabled();
    rerender(
      <ArenaTouchButtons inVehicle={false} onButton={onButton} look={look} />,
    );
    expect(sights).toHaveAttribute("aria-pressed", "false");
    expect(onButton).toHaveBeenLastCalledWith("ads", false);
  });

  it("puts the sights down when the page is hidden or the buttons go away", () => {
    const onButton = vi.fn();
    const { unmount } = render(
      <ArenaTouchButtons
        inVehicle={false}
        onButton={onButton}
        look={createTouchLook(() => 1)}
      />,
    );
    const sights = screen.getByRole("button", { name: "Richten" });
    fireEvent.click(sights);
    stubHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(sights).toHaveAttribute("aria-pressed", "false");
    expect(onButton).toHaveBeenLastCalledWith("ads", false);
    stubHidden(false);
    fireEvent.click(sights);
    expect(onButton).toHaveBeenLastCalledWith("ads", true);
    const before = onButton.mock.calls.length;
    unmount();
    expect(onButton.mock.calls.slice(before)).toContainEqual(["ads", false]);
  });
});
