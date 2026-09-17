import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ArenaNavigationMap from "./ArenaNavigationMap";
import type { NavigationMapData } from "@/lib/cityArena/render/navigationMap";
import { EMPTY_RADAR_SNAPSHOT } from "@/lib/cityArena/render/radar";
import { decodeRoadGraph } from "@/lib/cityArena/world/roadGraph";

const data: NavigationMapData = {
  graph: decodeRoadGraph({
    nodes: [0, 0, 400, 0],
    edges: [0, 1, 0, -1, 0, 400],
    classes: ["residential"],
    names: [],
  }),
  index: {
    version: 1,
    generatedAt: "",
    origin: { lat: 0, lon: 0 },
    unitsPerMetre: 4,
    bounds: { minX: 0, minY: 0, maxX: 4000, maxY: 4000 },
    tileSize: 8000,
    tiles: [],
    zones: [],
    landmarks: [
      {
        key: "cafe",
        name: "Café",
        center: [400, 0],
        style: "cafe",
        tile: { x: 0, y: 0 },
      },
    ],
  },
};

describe("full-screen navigation map", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      width: 700,
      height: 420,
      right: 710,
      bottom: 440,
      toJSON() {},
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mount() {
    const onDestination = vi.fn();
    const onClose = vi.fn();
    const rendered = render(
      <ArenaNavigationMap
        data={data}
        radar={EMPTY_RADAR_SNAPSHOT}
        onDestination={onDestination}
        onClose={onClose}
      />,
    );
    return {
      ...rendered,
      onDestination,
      onClose,
      canvas: screen.getByLabelText("Stratenkaart"),
    };
  }

  it("selects the world position once after a long press, but not a tap", () => {
    const { canvas, onDestination } = mount();
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 0,
      isPrimary: true,
      clientX: 430,
      clientY: 230,
    });
    act(() => vi.advanceTimersByTime(300));
    expect(onDestination).not.toHaveBeenCalled();
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(600));
    expect(onDestination).not.toHaveBeenCalled();
    fireEvent.pointerDown(canvas, {
      pointerId: 2,
      button: 0,
      isPrimary: true,
      clientX: 430,
      clientY: 230,
    });
    act(() => vi.advanceTimersByTime(550));
    expect(onDestination).toHaveBeenCalledExactlyOnceWith([100, 0]);
    act(() => vi.advanceTimersByTime(1000));
    expect(onDestination).toHaveBeenCalledTimes(1);
  });

  it("pans without setting a destination and cancels interrupted gestures", () => {
    const { canvas, onDestination, unmount } = mount();
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 0,
      isPrimary: true,
      clientX: 360,
      clientY: 230,
    });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 430, clientY: 230 });
    act(() => vi.advanceTimersByTime(600));
    expect(onDestination).not.toHaveBeenCalled();
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Kies kaartmidden" }));
    expect(onDestination).toHaveBeenLastCalledWith([-100, 0]);
    onDestination.mockClear();
    fireEvent.pointerDown(canvas, {
      pointerId: 2,
      button: 0,
      isPrimary: true,
      clientX: 360,
      clientY: 230,
    });
    fireEvent.pointerCancel(canvas, { pointerId: 2 });
    act(() => vi.advanceTimersByTime(600));
    expect(onDestination).not.toHaveBeenCalled();
    fireEvent.pointerDown(canvas, {
      pointerId: 3,
      button: 0,
      isPrimary: true,
      clientX: 360,
      clientY: 230,
    });
    unmount();
    act(() => vi.advanceTimersByTime(600));
    expect(onDestination).not.toHaveBeenCalled();
  });

  it("supports keyboard and named-place destinations and Escape to return", () => {
    const { canvas, onDestination, onClose } = mount();
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(onDestination).toHaveBeenLastCalledWith([80 / 0.7, 0]);
    fireEvent.change(screen.getByLabelText("Bekende plek"), {
      target: { value: "cafe" },
    });
    expect(onDestination).toHaveBeenLastCalledWith([100, 0]);
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows arrival and lets the player stop navigation", () => {
    const onDestination = vi.fn();
    render(
      <ArenaNavigationMap
        data={data}
        radar={{
          ...EMPTY_RADAR_SNAPSHOT,
          navigation: {
            destination: [0, 0],
            points: [],
            distanceM: 0,
            status: "arrived",
          },
        }}
        onDestination={onDestination}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Bestemming bereikt");
    fireEvent.click(screen.getByRole("button", { name: "Navigatie stoppen" }));
    expect(onDestination).toHaveBeenCalledWith(null);
  });
});
