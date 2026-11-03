import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagramFrame } from "../../lib/schemas/speelboek";
import { standardLineup } from "../../lib/speelboek/lineup";
import PoolEditorCanvas, { toDiagramPoint } from "./PoolEditorCanvas";

/** 600×300 overlay at the origin: 1 diagram unit = 2 px. */
const RECT = { left: 0, top: 0, width: 600, height: 300 };

function setup(
  tool: Parameters<typeof PoolEditorCanvas>[0]["tool"],
  frame = standardLineup(),
) {
  const onFrameChange = vi.fn();
  const onSelect = vi.fn();
  const utils = render(
    <PoolEditorCanvas
      frame={frame}
      labels={{}}
      tool={tool}
      selectedPlayerId={null}
      onFrameChange={onFrameChange}
      onSelect={onSelect}
    />,
  );
  const overlay = utils.getByRole("application");
  Object.defineProperty(overlay, "getBoundingClientRect", {
    value: () => ({
      ...RECT,
      right: 600,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => RECT,
    }),
  });
  Object.defineProperty(overlay, "setPointerCapture", { value: vi.fn() });
  return { overlay, onFrameChange, onSelect };
}

const px = ([x, y]: [number, number]) => ({
  clientX: x * 2,
  clientY: y * 2,
  pointerId: 1,
});

describe("PoolEditorCanvas", () => {
  afterEach(cleanup);

  it("maps pointer positions through the letterboxed viewBox", () => {
    expect(toDiagramPoint(RECT, 300, 150)).toEqual([150, 75]);
    // Taller box than 2:1: drawing is vertically centred.
    expect(
      toDiagramPoint({ left: 0, top: 0, width: 300, height: 300 }, 150, 150),
    ).toEqual([150, 75]);
    expect(
      toDiagramPoint({ left: 10, top: 20, width: 300, height: 150 }, 10, 20),
    ).toEqual([0, 0]);
  });

  it("drags a player with the select tool", () => {
    const { overlay, onFrameChange, onSelect } = setup("SELECT");
    fireEvent.pointerDown(overlay, px([150, 118]));
    expect(onSelect).toHaveBeenCalledWith("p3");
    fireEvent.pointerMove(overlay, px([160, 130]));
    const frame: DiagramFrame = onFrameChange.mock.calls.at(-1)![0];
    expect(frame.players.find((p) => p.id === "p3")).toMatchObject({
      x: 160,
      y: 130,
    });
    fireEvent.pointerUp(overlay, px([160, 130]));
  });

  it("draws a pass arrow from a player to the release point", () => {
    const { overlay, onFrameChange } = setup("PASS");
    fireEvent.pointerDown(overlay, px([150, 118]));
    fireEvent.pointerMove(overlay, px([200, 110]));
    expect(overlay.querySelector("[data-arrow-preview]")).not.toBeNull();
    fireEvent.pointerUp(overlay, px([232, 112]));
    const frame: DiagramFrame = onFrameChange.mock.calls.at(-1)![0];
    expect(frame.arrows).toEqual([
      { kind: "PASS", playerId: "p3", to: [232, 112] },
    ]);
  });

  it("ignores a tap that is too short to be an arrow", () => {
    const { overlay, onFrameChange } = setup("MOVE");
    fireEvent.pointerDown(overlay, px([150, 118]));
    fireEvent.pointerUp(overlay, px([152, 119]));
    expect(onFrameChange).not.toHaveBeenCalled();
  });

  it("hands out the ball and removes players", () => {
    const ball = setup("BALL");
    fireEvent.pointerDown(ball.overlay, px([258, 66]));
    expect(ball.onFrameChange.mock.calls[0][0].ballPlayerId).toBe("p1");
    cleanup();
    const del = setup("DELETE");
    fireEvent.pointerDown(del.overlay, px([78, 96]));
    expect(
      del.onFrameChange.mock.calls[0][0].players.some(
        (p: { id: string }) => p.id === "d4",
      ),
    ).toBe(false);
  });

  it("deselects when tapping open water", () => {
    const { overlay, onSelect, onFrameChange } = setup("SELECT");
    fireEvent.pointerDown(overlay, px([150, 75]));
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onFrameChange).not.toHaveBeenCalled();
  });
});
