import {
  ZOOM_LEVELS,
  type Camera,
  type Viewport,
  type ZoomLevel,
} from "./camera";
import type { Point } from "../world/projection";

/** A tracked player position, including players waiting to respawn. */
export type SplitPlayer = { id: number; x: number; y: number };
type ScreenRect = { x: number; y: number; width: number; height: number };
/** A camera plus its clipped region in CSS pixels. */
export type SplitView = {
  ids: number[];
  rect: ScreenRect;
  clip: Point[];
  camera: Camera;
  zoom: number;
};
/** Persistent, deterministic compositor state. */
export type SplitScreen = { views: SplitView[]; dividerOpacity: number };
/** Metres at which an existing group splits; new groups merge below 100 m. */
export const SPLIT_DISTANCE_M = 120;

function sameGroup(
  previous: SplitScreen,
  first: number,
  second: number,
): boolean {
  return previous.views.some(
    (view) => view.ids.includes(first) && view.ids.includes(second),
  );
}

function clusters(
  players: SplitPlayer[],
  previous: SplitScreen,
): SplitPlayer[][] {
  const groups = [...players]
    .sort((a, b) => a.id - b.id)
    .map((player) => [player]);
  for (let first = 0; first < groups.length; first += 1) {
    for (let second = first + 1; second < groups.length;) {
      const left = groups[first]!;
      const right = groups[second]!;
      const fits = left.every((a) =>
        right.every(
          (b) =>
            Math.hypot(a.x - b.x, a.y - b.y) <=
            (sameGroup(previous, a.id, b.id) ? SPLIT_DISTANCE_M : 100),
        ),
      );
      if (fits) {
        left.push(...right);
        groups.splice(second, 1);
      } else second += 1;
    }
  }
  return groups;
}

function centre(group: SplitPlayer[]): Point {
  return [
    (Math.min(...group.map((p) => p.x)) + Math.max(...group.map((p) => p.x))) /
      2,
    (Math.min(...group.map((p) => p.y)) + Math.max(...group.map((p) => p.y))) /
      2,
  ];
}

function rectangle(rect: ScreenRect): Point[] {
  return [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ];
}

function halfScreen(size: Viewport, direction: Point, sign: number): Point[] {
  const corners = rectangle({
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
  });
  const side = (point: Point): number =>
    sign *
    ((point[0] - size.width / 2) * direction[0] +
      (point[1] - size.height / 2) * direction[1]);
  const clipped: Point[] = [];
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index]!;
    const end = corners[(index + 1) % corners.length]!;
    const from = side(start);
    const to = side(end);
    if (from <= 0) clipped.push(start);
    if ((from < 0 && to > 0) || (from > 0 && to < 0)) {
      const fraction = from / (from - to);
      clipped.push([
        start[0] + (end[0] - start[0]) * fraction,
        start[1] + (end[1] - start[1]) * fraction,
      ]);
    }
  }
  return clipped;
}

function bounds(points: Point[]): ScreenRect {
  const x = Math.min(...points.map((point) => point[0]));
  const y = Math.min(...points.map((point) => point[1]));
  return {
    x,
    y,
    width: Math.max(...points.map((point) => point[0])) - x,
    height: Math.max(...points.map((point) => point[1])) - y,
  };
}

function cameraRegion(clip: Point[]): { rect: ScreenRect; safe: ScreenRect } {
  const box = bounds(clip);
  const x = clip.reduce((sum, point) => sum + point[0], 0) / clip.length;
  const y = clip.reduce((sum, point) => sum + point[1], 0) / clip.length;
  let share = 1;
  for (let index = 0; index < clip.length; index += 1) {
    const start = clip[index]!;
    const end = clip[(index + 1) % clip.length]!;
    const nx = end[1] - start[1];
    const ny = start[0] - end[0];
    const reach = (Math.abs(nx) * box.width + Math.abs(ny) * box.height) / 2;
    if (reach > 0)
      share = Math.min(
        share,
        Math.abs(nx * (x - start[0]) + ny * (y - start[1])) / reach,
      );
  }
  const width = 2 * Math.max(x - box.x, box.x + box.width - x);
  const height = 2 * Math.max(y - box.y, box.y + box.height - y);
  return {
    rect: { x: x - width / 2, y: y - height / 2, width, height },
    safe: { x, y, width: box.width * share, height: box.height * share },
  };
}

function regions(groups: SplitPlayer[][], size: Viewport): Point[][] {
  if (groups.length === 1)
    return [rectangle({ x: 0, y: 0, width: size.width, height: size.height })];
  if (groups.length === 2) {
    const first = centre(groups[0]!);
    const second = centre(groups[1]!);
    const direction: Point = [second[0] - first[0], second[1] - first[1]];
    return [halfScreen(size, direction, 1), halfScreen(size, direction, -1)];
  }
  const columns = groups.length <= 4 ? 2 : size.width >= size.height ? 3 : 2;
  const rows = Math.ceil(groups.length / columns);
  return groups.map((_, index) => {
    const row = Math.floor(index / columns);
    const count = Math.min(columns, groups.length - row * columns);
    return rectangle({
      x: ((index % columns) * size.width) / count,
      y: (row * size.height) / rows,
      width: size.width / count,
      height: size.height / rows,
    });
  });
}

function zoomFor(group: SplitPlayer[], rect: ScreenRect): number {
  const spreadX =
    Math.max(...group.map((p) => p.x)) - Math.min(...group.map((p) => p.x));
  const spreadY =
    Math.max(...group.map((p) => p.y)) - Math.min(...group.map((p) => p.y));
  return Math.min(
    12,
    rect.width / (spreadX + 32),
    rect.height / (spreadY + 32),
    Math.max(4, rect.width / 100),
  );
}

/** Clusters without transitive chains, lays out 1–8 views and eases cameras and regions. */
export function updateSplitScreen(
  previous: SplitScreen,
  players: SplitPlayer[],
  size: Viewport,
  dt: number,
  reducedMotion = false,
): SplitScreen {
  if (!players.length || size.width <= 0 || size.height <= 0)
    return { views: [], dividerOpacity: 0 };
  const groups = clusters(players.slice(0, 8), previous);
  const clips = regions(groups, size);
  const previousBounds = previous.views.length
    ? bounds(previous.views.flatMap((view) => view.clip))
    : null;
  const easeRegions =
    previousBounds?.width === size.width &&
    previousBounds.height === size.height &&
    previous.views.length === groups.length &&
    groups.every((group, index) => {
      const old = previous.views[index]!;
      return (
        old.clip.length === clips[index]!.length &&
        old.ids.join() === group.map((player) => player.id).join()
      );
    });
  const ease = reducedMotion ? 1 : 1 - Math.exp(-8 * Math.max(0, dt));
  const blend = (from: number, to: number): number => from + (to - from) * ease;
  const views = groups.map((group, index): SplitView => {
    const ids = group.map((player) => player.id);
    const clip = clips[index]!;
    const region = cameraRegion(clip);
    const target = centre(group);
    const old = previous.views.find((view) => view.ids.includes(ids[0]!));
    const zoom = old
      ? blend(old.zoom, zoomFor(group, region.safe))
      : zoomFor(group, region.safe);
    let rasterZoom: ZoomLevel = ZOOM_LEVELS[0];
    for (const level of ZOOM_LEVELS)
      if (Math.abs(level - zoom) < Math.abs(rasterZoom - zoom))
        rasterZoom = level;
    // Change all polygon topologies together so merging and resizing cannot leave holes.
    const movedClip =
      easeRegions && old
        ? clip.map((point, i): Point => [
            blend(old.clip[i]![0], point[0]),
            blend(old.clip[i]![1], point[1]),
          ])
        : clip;
    return {
      ids,
      clip: movedClip,
      rect: cameraRegion(movedClip).rect,
      zoom,
      camera: {
        x: old ? blend(old.camera.x, target[0]) : target[0],
        y: old ? blend(old.camera.y, target[1]) : target[1],
        zoom: rasterZoom,
      },
    };
  });
  const changed = previous.views.length !== views.length;
  return {
    views,
    dividerOpacity: blend(
      changed ? 0 : previous.dividerOpacity,
      views.length > 1 ? 1 : 0,
    ),
  };
}
