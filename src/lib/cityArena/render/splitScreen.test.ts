import { describe, expect, it } from "vitest";
import { updateSplitScreen, type SplitScreen } from "./splitScreen";

const empty: SplitScreen = { views: [], dividerOpacity: 0 };
const size = { width: 1280, height: 720 };
const player = (id: number, x: number, y = 0) => ({ id, x, y });
const layout = (players: ReturnType<typeof player>[], previous = empty) =>
  updateSplitScreen(previous, players, size, 1, true);

describe("TV camera layout", () => {
  it("accepts the browser's DOMRect viewport", () => {
    const viewport = new DOMRect(0, 0, 1280, 720);
    for (const distance of [50, 200]) {
      const result = updateSplitScreen(
        empty,
        [player(0, 0), player(1, distance)],
        viewport,
        1,
        true,
      );
      expect(
        result.views.every((view) => view.clip.flat().every(Number.isFinite)),
      ).toBe(true);
      expect(result.views.every((view) => Number.isFinite(view.zoom))).toBe(
        true,
      );
    }
  });
  it("keeps the whole canvas covered during split, merge and resize transitions", () => {
    let previous = layout([player(0, 0)]);
    for (const positions of [
      [player(0, 0), player(1, 200)],
      [player(0, 0), player(1, 20)],
      [player(0, 0), player(1, 300, 200), player(2, 600)],
    ]) {
      previous = updateSplitScreen(previous, positions, size, 1 / 60);
      const area = previous.views.reduce(
        (sum, view) =>
          sum +
          Math.abs(
            view.clip.reduce((total, point, index) => {
              const next = view.clip[(index + 1) % view.clip.length]!;
              return total + point[0] * next[1] - next[0] * point[1];
            }, 0),
          ) /
            2,
        0,
      );
      expect(area).toBeCloseTo(size.width * size.height, 5);
    }
  });
  it("fills the canvas for nearby players and bounds clustering across a chain", () => {
    const together = layout([player(0, 0), player(1, 80)]);
    expect(together.views).toHaveLength(1);
    expect(together.views[0]?.rect).toEqual({ x: 0, y: 0, ...size });
    expect(
      layout([player(0, 0), player(1, 80), player(2, 160)]).views,
    ).toHaveLength(2);
  });

  it("uses hysteresis before splitting and merging", () => {
    const joined = layout([player(0, 0), player(1, 80)]);
    const near = layout([player(0, 0), player(1, 110)], joined);
    expect(near.views).toHaveLength(1);
    const apart = layout([player(0, 0), player(1, 121)], near);
    expect(apart.views).toHaveLength(2);
    expect(layout([player(0, 0), player(1, 110)], apart).views).toHaveLength(2);
    expect(layout([player(0, 0), player(1, 90)], apart).views).toHaveLength(1);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "covers the whole screen exactly once with %i groups",
    (count) => {
      const result = layout(
        Array.from({ length: count }, (_, index) =>
          player(index, index * 200, (index % 2) * 180),
        ),
      );
      expect(result.views).toHaveLength(count);
      const area = result.views.reduce(
        (sum, view) =>
          sum +
          Math.abs(
            view.clip.reduce((total, point, index) => {
              const next = view.clip[(index + 1) % view.clip.length]!;
              return total + point[0] * next[1] - next[0] * point[1];
            }, 0),
          ) /
            2,
        0,
      );
      expect(area).toBeCloseTo(size.width * size.height, 5);
      expect(result.views.flatMap((view) => view.ids)).toEqual(
        Array.from({ length: count }, (_, id) => id),
      );
    },
  );

  it("keeps diagonal cameras strictly inside their own half, with a diagonal boundary", () => {
    const result = layout([player(0, 0, 0), player(1, 250, 250)]);
    for (const [index, view] of result.views.entries()) {
      const centreX = view.rect.x + view.rect.width / 2;
      const centreY = view.rect.y + view.rect.height / 2;
      const side = centreX - size.width / 2 + centreY - size.height / 2;
      expect(index === 0 ? side < 0 : side > 0).toBe(true);
    }
    const cut = result.views[0]!.clip.filter(
      (point) =>
        Math.abs(point[0] - size.width / 2 + point[1] - size.height / 2) <
        0.001,
    );
    expect(cut).toHaveLength(2);
    expect(cut[0]![0]).not.toBe(cut[1]![0]);
    expect(cut[0]![1]).not.toBe(cut[1]![1]);
  });

  it("keeps ordering stable, eases motion and honours reduced motion and resize", () => {
    const first = layout([player(0, 0), player(1, 300)]);
    const moved = updateSplitScreen(
      first,
      [player(1, 400), player(0, 50)],
      size,
      1 / 60,
    );
    expect(moved.views.map((view) => view.ids)).toEqual([[0], [1]]);
    expect(moved.views[0]!.camera.x).toBeGreaterThan(0);
    expect(moved.views[0]!.camera.x).toBeLessThan(50);
    const resized = updateSplitScreen(
      moved,
      [player(0, 50)],
      { width: 390, height: 740 },
      0,
      true,
    );
    expect(resized.views[0]?.rect).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 740,
    });
    expect(resized.views[0]?.camera.x).toBe(50);
    expect(updateSplitScreen(first, [], size, 1).views).toEqual([]);
  });
});
