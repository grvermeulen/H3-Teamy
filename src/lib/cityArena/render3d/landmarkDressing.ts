/**
 * The silhouettes that make a landmark read as one from the street, where the 2D map only has a
 * coloured roof: a church tower with a spire over a steep nave roof, the pool's blue glass hall,
 * the campus's lit glass band and roof fins, the café's striped awning, the brewery's chimney
 * and copper kettle. Each dressing owns its geometry and materials (landmarks are few), so it is
 * freed whole with `disposeObject`.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  type Material,
  type Object3D,
} from "three";
import {
  pointInPolygon,
  polygonArea,
  polygonCentroid,
} from "../mapBuild/geometry";
import type { LandmarkStyle } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { headingToRotationY } from "./coords";
import {
  farthestVertex,
  offsetPoint,
  orientedBox,
  type OrientedBox,
} from "./footprint";
import { LAMP_GLOW, WINDOW_COLD } from "./palette3d";
import { pitchedRoofGeometry } from "./pitchedRoof";

/** Church tower: side as a share of the footprint's square root, clamped; rise above the eaves. */
const TOWER_SIDE_SHARE = 0.28;
const TOWER_MIN_SIDE_M = 4.5;
const TOWER_MAX_SIDE_M = 8;
const TOWER_RISE_M = 11;
/** How far the tower stands in from the far corner, as a share of its side. */
const TOWER_INSET = 0.75;
/** The spire's height, and its base radius as a share of the tower side (covers the corners). */
const SPIRE_M = 13;
const SPIRE_RADIUS_SHARE = 0.72;
/** A spire is a four-sided pyramid, turned so its base lines up with the tower's sides. */
const SPIRE_SIDES = 4;
/** Clock faces: radius as a share of the tower side, drop below the tower top, standoff. */
const CLOCK_RADIUS_SHARE = 0.24;
const CLOCK_DROP_M = 2.4;
const CLOCK_STANDOFF_M = 0.03;
const CLOCK_SEGMENTS = 20;
/** The cross on the spire: height, arm span and bar thickness, metres. */
const CROSS_M = 1.4;
const CROSS_ARM_M = 0.8;
const CROSS_BAR_M = 0.12;
/** How far above the upright's middle the cross's arm sits, metres. */
const CROSS_ARM_RAISE_M = CROSS_M / 6;
/** A church nave's steep roof rise, as a share of its width. */
const NAVE_PITCH = 0.55;
/** The highest a nave roof rises above the eaves, metres. */
const NAVE_MAX_RISE_M = 12;
/** The tower's top stands at least this far above the nave's ridge, metres. */
const TOWER_OVER_RIDGE_M = 4;
/** The pool's glass hall roof rise as a share of its width, clamped, and its glass opacity. */
const POOL_PITCH = 0.3;
const POOL_MIN_RISE_M = 2;
const POOL_MAX_RISE_M = 6;
const POOL_GLASS_OPACITY = 0.45;
/** The campus band: its height, how far it stands off the wall, and where it sits (share of height). */
const BAND_HEIGHT_M = 1.4;
const BAND_STANDOFF_M = 0.12;
const BAND_LEVEL = 0.5;
/** How strongly the campus band's panes glow. */
const BAND_GLOW = 0.55;
/** Campus roof fins: spacing across the roof, height, thickness, and length as a share of the roof. */
const FIN_SPACING_M = 3;
const FIN_HEIGHT_M = 1.1;
const FIN_THICKNESS_M = 0.15;
const FIN_LENGTH_SHARE = 0.8;
const MAX_FINS = 12;
/** Café awning: share of the long wall it covers (capped), depth, height at the wall and its drop. */
const AWNING_SHARE = 0.8;
const AWNING_MAX_M = 12;
const AWNING_DEPTH_M = 1.6;
const AWNING_TOP_M = 3;
const AWNING_DROP_M = 0.5;
/** Width of one awning stripe, metres. */
const STRIPE_M = 0.5;
/** Brewery chimney: rise above the eaves, radii at top and foot, inset from the far corner. */
const CHIMNEY_RISE_M = 14;
const CHIMNEY_TOP_M = 0.7;
const CHIMNEY_FOOT_M = 1;
const CHIMNEY_INSET_M = 1.6;
const ROUND_SIDES = 16;
/** Brewery copper kettle: radius, body height and the vent pipe on top, metres. */
const KETTLE_RADIUS_M = 2;
const KETTLE_BODY_M = 2.2;
const PIPE_RADIUS_M = 0.2;
const PIPE_M = 2.5;
/** How deep the vent pipe sits into the kettle's dome, metres. */
const PIPE_SUNK_M = 0.6;

/** Colours of the dressing, in the 2D map's landmark palette where it has one. */
const STONE = 0xb2ab9b;
const SLATE = 0x4b6670;
/** The church's gable ends, in the brick façade's own red-brown. */
const NAVE_BRICK = 0x6d3b2c;
const GILT = 0xe5cf98;
const GILT_GLOW = 0x3a2f18;
const POOL_GLASS = 0x3f8fc9;
const POOL_GLOW = 0x123f5a;
const BAND_GLASS = 0x1c2c3c;
const FIN_GREY = 0x8d949b;
const AWNING_RED = 0xb3312c;
const AWNING_CREAM = 0xefe6d2;
const CHIMNEY_BRICK = 0x7a3b2a;
const COPPER = 0xb0663a;
const COPPER_GLOW = 0x2a1206;

/** A landmark's footprint in the dressing's frame: centred on its centroid. */
type Footprint = {
  ring: Point[];
  box: OrientedBox;
  height: number;
  area: number;
};

/**
 * A corner of the footprint moved toward the centroid (the frame's zero) by `inset`, never past
 * the centroid.
 */
function insetCorner(ring: readonly Point[], inset: number): Point {
  const corner = farthestVertex(ring, [0, 0]);
  const reach = Math.hypot(...corner);
  return reach > 0
    ? offsetPoint(corner, [corner, -Math.min(inset, reach) / reach])
    : corner;
}

/** A matte material, optionally glowing. */
function lambert(colour: number, emissive = 0x000000): MeshLambertMaterial {
  return new MeshLambertMaterial({ color: colour, emissive });
}

/** A mesh placed at a point of the frame (x, height, y). */
function placed(
  geometry: BufferGeometry,
  material: Material,
  [x, y]: Point,
  height: number,
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, height, y);
  return mesh;
}

/** A pitched roof following the footprint: its slopes and its gable ends in their materials. */
function pitchedRoof(
  footprint: Footprint,
  rise: number,
  slopes: Material,
  gables: Material,
): Mesh[] {
  const roof = pitchedRoofGeometry(footprint.ring, footprint.height, rise);
  return [new Mesh(roof.slopes, slopes), new Mesh(roof.gables, gables)];
}

/** The four clock faces on a tower of `side`, glowing warm, `top` metres up. */
function clockFaces(side: number, top: number, material: Material): Mesh[] {
  const radius = side * CLOCK_RADIUS_SHARE;
  const reach = side / 2 + CLOCK_STANDOFF_M;
  return [0, 1, 2, 3].map((quarter) => {
    const turn = (quarter * Math.PI) / 2;
    const face = placed(
      new CircleGeometry(radius, CLOCK_SEGMENTS),
      material,
      [Math.sin(turn) * reach, Math.cos(turn) * reach],
      top - CLOCK_DROP_M,
    );
    face.rotation.y = turn;
    return face;
  });
}

/** A church: steep slate nave roof, and a stone tower with clock, spire and cross in a far corner. */
function church(footprint: Footprint): Object3D[] {
  const { ring, box, height } = footprint;
  const side = Math.min(
    TOWER_MAX_SIDE_M,
    Math.max(TOWER_MIN_SIDE_M, Math.sqrt(footprint.area) * TOWER_SIDE_SHARE),
  );
  const at = insetCorner(ring, side * TOWER_INSET);
  const rise = Math.min(NAVE_MAX_RISE_M, box.width * NAVE_PITCH);
  const top = height + Math.max(TOWER_RISE_M, rise + TOWER_OVER_RIDGE_M);
  const slate = lambert(SLATE);
  const tower = new Group();
  tower.position.set(at[0], 0, at[1]);
  tower.rotation.y = headingToRotationY(Math.atan2(box.long[1], box.long[0]));
  const spire = placed(
    new ConeGeometry(side * SPIRE_RADIUS_SHARE, SPIRE_M, SPIRE_SIDES),
    slate,
    [0, 0],
    top + SPIRE_M / 2,
  );
  spire.rotation.y = Math.PI / SPIRE_SIDES;
  const gilt = lambert(GILT, GILT_GLOW);
  const crossTop = top + SPIRE_M + CROSS_M / 2;
  tower.add(
    placed(new BoxGeometry(side, top, side), lambert(STONE), [0, 0], top / 2),
    spire,
    ...clockFaces(side, top, lambert(GILT, LAMP_GLOW)),
    placed(
      new BoxGeometry(CROSS_BAR_M, CROSS_M, CROSS_BAR_M),
      gilt,
      [0, 0],
      crossTop,
    ),
    placed(
      new BoxGeometry(CROSS_ARM_M, CROSS_BAR_M, CROSS_BAR_M),
      gilt,
      [0, 0],
      crossTop + CROSS_ARM_RAISE_M,
    ),
  );
  return [...pitchedRoof(footprint, rise, slate, lambert(NAVE_BRICK)), tower];
}

/** The pool: a translucent blue glass hall roof and gables, faintly lit from the water inside. */
function pool(footprint: Footprint): Object3D[] {
  const glass = new MeshLambertMaterial({
    color: POOL_GLASS,
    emissive: POOL_GLOW,
    transparent: true,
    opacity: POOL_GLASS_OPACITY,
    depthWrite: false,
    side: DoubleSide,
  });
  const rise = Math.min(
    POOL_MAX_RISE_M,
    Math.max(POOL_MIN_RISE_M, footprint.box.width * POOL_PITCH),
  );
  return pitchedRoof(footprint, rise, glass, glass);
}

/** A band of quads just outside the ring's walls, from `bottom` up `height`. */
function bandGeometry(
  ring: readonly Point[],
  bottom: number,
  height: number,
): BufferGeometry {
  const positions: number[] = [];
  const turn = signedArea(ring) > 0 ? 1 : -1;
  ring.forEach((from, index) => {
    const to = ring[(index + 1) % ring.length];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) return;
    const out: Point = [
      (turn * (to[1] - from[1])) / length,
      (-turn * (to[0] - from[0])) / length,
    ];
    const [p, q] = [
      offsetPoint(from, [out, BAND_STANDOFF_M]),
      offsetPoint(to, [out, BAND_STANDOFF_M]),
    ];
    const [b0, b1] = [
      [p[0], bottom, p[1]],
      [q[0], bottom, q[1]],
    ];
    const [t0, t1] = [
      [p[0], bottom + height, p[1]],
      [q[0], bottom + height, q[1]],
    ];
    const quad = turn > 0 ? [b0, t1, b1, b0, t0, t1] : [b0, b1, t1, b0, t1, t0];
    positions.push(...quad.flat());
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Twice the signed area of a ring (positive counter-clockwise in x, y). */
function signedArea(ring: readonly Point[]): number {
  return ring.reduce((sum, [x1, y1], index) => {
    const [x2, y2] = ring[(index + 1) % ring.length];
    return sum + x1 * y2 - x2 * y1;
  }, 0);
}

/** The campus: a lit glass band round the middle and a row of fins on the roof. */
function campus(footprint: Footprint): Object3D[] {
  const { box, height, ring } = footprint;
  const bottom = Math.max(0, height * BAND_LEVEL - BAND_HEIGHT_M / 2);
  const band = new Mesh(
    bandGeometry(ring, bottom, BAND_HEIGHT_M),
    new MeshLambertMaterial({
      color: BAND_GLASS,
      emissive: WINDOW_COLD,
      emissiveIntensity: BAND_GLOW,
    }),
  );
  const count = Math.min(
    MAX_FINS,
    Math.max(1, Math.floor(box.width / FIN_SPACING_M)),
  );
  const grey = lambert(FIN_GREY);
  const fins = Array.from({ length: count }, (_, index) => {
    const across = ((index + 0.5) / count - 0.5) * box.width;
    const through = offsetPoint(box.centre, [box.across, across]);
    const chord = chordThrough(ring, through, box.long);
    if (!chord) return [];
    const length = (chord[1] - chord[0]) * FIN_LENGTH_SHARE;
    const middle = offsetPoint(through, [box.long, (chord[0] + chord[1]) / 2]);
    const geometry = new BoxGeometry(length, FIN_HEIGHT_M, FIN_THICKNESS_M);
    const fin = placed(geometry, grey, middle, height + FIN_HEIGHT_M / 2);
    fin.rotation.y = headingToRotationY(Math.atan2(box.long[1], box.long[0]));
    return [fin];
  });
  return [band, ...fins.flat()];
}

/** The 2D cross product of two vectors. */
function cross(a: Point, b: Point): number {
  return a[0] * b[1] - a[1] * b[0];
}

/**
 * The stretch of the line through `point` along the unit `direction` that lies inside the ring
 * around `point`, as distances along the line from it, or null when the point lies outside.
 */
function chordThrough(
  ring: Point[],
  point: Point,
  direction: Point,
): [number, number] | null {
  if (!pointInPolygon(point, ring)) return null;
  let [before, after] = [-Infinity, Infinity];
  ring.forEach((a, index) => {
    const b = ring[(index + 1) % ring.length];
    const edge: Point = [b[0] - a[0], b[1] - a[1]];
    const denominator = cross(direction, edge);
    if (denominator === 0) return;
    const toEdge: Point = [a[0] - point[0], a[1] - point[1]];
    const along = cross(toEdge, edge) / denominator;
    const share = cross(toEdge, direction) / denominator;
    if (share < 0 || share >= 1) return;
    if (along <= 0) before = Math.max(before, along);
    else after = Math.min(after, along);
  });
  return Number.isFinite(before) && Number.isFinite(after)
    ? [before, after]
    : null;
}

/** The longest wall of a ring and the unit direction out of the building from it. */
function longestWall(ring: readonly Point[]): {
  from: Point;
  to: Point;
  out: Point;
} {
  const walls = ring.map((from, index) => {
    const to = ring[(index + 1) % ring.length];
    return { from, to, length: Math.hypot(to[0] - from[0], to[1] - from[1]) };
  });
  const { from, to, length } = walls.reduce((best, wall) =>
    wall.length > best.length ? wall : best,
  );
  const turn = signedArea(ring) > 0 ? 1 : -1;
  return {
    from,
    to,
    out: [
      (turn * (to[1] - from[1])) / length,
      (-turn * (to[0] - from[0])) / length,
    ],
  };
}

/** One sloping stripe of an awning as two triangles, with its (linear) colour per vertex. */
function pushStripe(
  positions: number[],
  colours: number[],
  corners: number[][],
  colour: number,
): void {
  const { r, g, b } = new Color(colour);
  for (const index of [0, 1, 2, 0, 2, 3]) {
    positions.push(...corners[index]);
    colours.push(r, g, b);
  }
}

/** The café: a red-and-cream striped awning sloping out from its longest wall. */
function cafe(footprint: Footprint): Object3D[] {
  const { from, to, out } = longestWall(footprint.ring);
  const wall = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const span = Math.min(AWNING_MAX_M, wall * AWNING_SHARE);
  const along: Point = [(to[0] - from[0]) / wall, (to[1] - from[1]) / wall];
  const start = offsetPoint(from, [along, (wall - span) / 2]);
  const stripes = Math.max(1, Math.round(span / STRIPE_M));
  const top = Math.min(footprint.height, AWNING_TOP_M);
  const [positions, colours]: [number[], number[]] = [[], []];
  for (let stripe = 0; stripe < stripes; stripe++) {
    const [a, b] = [
      offsetPoint(start, [along, (stripe * span) / stripes]),
      offsetPoint(start, [along, ((stripe + 1) * span) / stripes]),
    ];
    const [c, d] = [
      offsetPoint(b, [out, AWNING_DEPTH_M]),
      offsetPoint(a, [out, AWNING_DEPTH_M]),
    ];
    const low = top - AWNING_DROP_M;
    const corners = [
      [a[0], top, a[1]],
      [b[0], top, b[1]],
      [c[0], low, c[1]],
      [d[0], low, d[1]],
    ];
    pushStripe(
      positions,
      colours,
      corners,
      stripe % 2 === 0 ? AWNING_RED : AWNING_CREAM,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return [
    new Mesh(
      geometry,
      new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
    ),
  ];
}

/** A copper brewing kettle standing on a roof `height` up: body, domed lid and vent pipe. */
function copperKettle(height: number): Mesh[] {
  const copper = lambert(COPPER, COPPER_GLOW);
  const bodyTop = height + KETTLE_BODY_M;
  const pipeFoot = bodyTop + KETTLE_RADIUS_M - PIPE_SUNK_M;
  const body = new CylinderGeometry(
    KETTLE_RADIUS_M,
    KETTLE_RADIUS_M,
    KETTLE_BODY_M,
    ROUND_SIDES,
  );
  const dome = new SphereGeometry(
    KETTLE_RADIUS_M,
    ROUND_SIDES,
    ROUND_SIDES / 2,
    0,
    2 * Math.PI,
    0,
    Math.PI / 2,
  );
  const pipe = new CylinderGeometry(
    PIPE_RADIUS_M,
    PIPE_RADIUS_M,
    PIPE_M,
    ROUND_SIDES / 2,
  );
  return [
    placed(body, copper, [0, 0], height + KETTLE_BODY_M / 2),
    placed(dome, copper, [0, 0], bodyTop),
    placed(pipe, copper, [0, 0], pipeFoot + PIPE_M / 2),
  ];
}

/** The brewery: a tall brick chimney in its far corner and a copper kettle on the roof. */
function brewery(footprint: Footprint): Object3D[] {
  const { ring, height } = footprint;
  const at = insetCorner(ring, CHIMNEY_INSET_M);
  const chimneyHeight = height + CHIMNEY_RISE_M;
  const chimney = new CylinderGeometry(
    CHIMNEY_TOP_M,
    CHIMNEY_FOOT_M,
    chimneyHeight,
    ROUND_SIDES,
  );
  return [
    placed(chimney, lambert(CHIMNEY_BRICK), at, chimneyHeight / 2),
    ...copperKettle(height),
  ];
}

/** The dressing builder of each style. */
const DRESSINGS: Record<LandmarkStyle, (footprint: Footprint) => Object3D[]> = {
  church,
  pool,
  campus,
  cafe,
  brewery,
};

/**
 * A landmark's dressing: church — a stone tower in the corner farthest from the centroid with
 * clock faces, a slate spire and a gilt cross, over a steep slate nave roof; pool — a translucent
 * blue glass hall roof; campus — a lit glass band round the walls and fins along the roof; café —
 * a striped awning off the longest wall; brewery — a brick chimney and a copper kettle.
 *
 * @param style - The landmark's style.
 * @param ring - Its footprint, world metres.
 * @param height - Its wall height (the eaves), metres.
 * @returns A group standing at the footprint's centroid `(x, 0, y)` in world coordinates, owning
 *   its geometry and materials.
 */
export function landmarkDressing(
  style: LandmarkStyle,
  ring: readonly Point[],
  height: number,
): Object3D {
  const [cx, cy] = polygonCentroid([...ring]);
  const local = ring.map(([x, y]): Point => [x - cx, y - cy]);
  const footprint: Footprint = {
    ring: local,
    box: orientedBox(local),
    height,
    area: polygonArea(local),
  };
  const group = new Group();
  group.position.set(cx, 0, cy);
  group.add(...DRESSINGS[style](footprint));
  return group;
}
