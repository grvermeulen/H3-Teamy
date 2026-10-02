/**
 * Low-poly building blocks for the 3D cast: bevelled, tapered blocks and faceted rods, painted
 * with vertex colours and flat-shaded, ready to merge into one geometry per model.
 */
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** A point or extent as `[x, y, z]`, metres. */
export type Vec3 = readonly [number, number, number];

/** How much darker the bottom of a part is than its top, unless a part says otherwise. */
const DEFAULT_GRADIENT = 0.12;

/** A box-shaped part. */
export type BlockSpec = {
  /** Extent along x (front–back), y (up) and z (side to side). */
  size: Vec3;
  /** Centre, in the model's space. */
  at: Vec3;
  /** sRGB hex colour. */
  colour: number;
  /** Bevel width as a share (0…0.9) of the smallest half-extent; 0 keeps sharp edges. */
  chamfer?: number;
  /** Width of the bottom face relative to the top (x and z); 1 keeps the sides straight. */
  taper?: number;
  /** Euler angles (XYZ), radians, turning the block about its centre before it is placed. */
  rotation?: Vec3;
  /** Darkening of the bottom relative to the top, 0…1; defaults to {@link DEFAULT_GRADIENT}. */
  gradient?: number;
};

/** A faceted cylinder or cone. */
export type RodSpec = {
  /** Radius at the far end along the axis (the top for `y`, +x for `x`, +z for `z`). */
  radius: number;
  /** Radius at the near end; defaults to `radius`. 0 makes a cone. */
  radiusStart?: number;
  length: number;
  /** Centre, in the model's space. */
  at: Vec3;
  /** Axis the rod runs along. */
  axis: "x" | "y" | "z";
  /** sRGB hex colour. */
  colour: number;
  /** Facets around the axis; defaults to {@link ROD_SIDES}. */
  sides?: number;
  /** Darkening of the bottom relative to the top, 0…1; defaults to {@link DEFAULT_GRADIENT}. */
  gradient?: number;
};

/** Facets around a rod unless it asks for more or fewer. */
const ROD_SIDES = 8;

/** The eight corner signs of a box. */
const OCTANTS: Vec3[] = [-1, 1].flatMap((sx) =>
  [-1, 1].flatMap((sy) => [-1, 1].map((sz): Vec3 => [sx, sy, sz])),
);

/** Axis index pairs of the twelve box edges, each with both sign combinations. */
const EDGE_AXES: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 2],
];

/** The two axes other than `axis`, in ascending order. */
function otherAxes(axis: number): [number, number] {
  return axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
}

/** A point of a bevelled box: `axis` at `sign`·half, the others at their inset signs. */
function faceCorner(
  half: Vec3,
  bevel: number,
  axis: number,
  sign: number,
  signs: readonly number[],
): Vector3 {
  const point = [0, 0, 0];
  for (let other = 0; other < 3; other += 1) {
    point[other] =
      other === axis
        ? sign * half[other]
        : signs[other] * (half[other] - bevel);
  }
  return new Vector3(point[0], point[1], point[2]);
}

/** Pushes triangle `a b c` into `out`, wound so its normal points away from the origin. */
function pushOutward(out: number[], a: Vector3, b: Vector3, c: Vector3): void {
  const normal = new Vector3()
    .subVectors(b, a)
    .cross(new Vector3().subVectors(c, a));
  const centroid = new Vector3().add(a).add(b).add(c);
  const [second, third] = normal.dot(centroid) >= 0 ? [b, c] : [c, b];
  out.push(...a.toArray(), ...second.toArray(), ...third.toArray());
}

/** Pushes the quad `a b c d` (in order around its rim) as two outward triangles. */
function pushQuad(out: number[], quad: Vector3[]): void {
  pushOutward(out, quad[0], quad[1], quad[2]);
  pushOutward(out, quad[0], quad[2], quad[3]);
}

/** The six flat faces of a bevelled box. */
function pushFaces(out: number[], half: Vec3, bevel: number): void {
  for (let axis = 0; axis < 3; axis += 1) {
    const [first, second] = otherAxes(axis);
    for (const sign of [-1, 1]) {
      const rim = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([u, v]) => {
        const signs = [0, 0, 0];
        signs[first] = u;
        signs[second] = v;
        return faceCorner(half, bevel, axis, sign, signs);
      });
      pushQuad(out, rim);
    }
  }
}

/** The twelve bevel strips and eight corner facets of a bevelled box. */
function pushBevels(out: number[], half: Vec3, bevel: number): void {
  for (const [a, b] of EDGE_AXES) {
    const c = 3 - a - b;
    for (const [sa, sb] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]) {
      const signs = (sc: number): number[] => {
        const all = [0, 0, 0];
        all[a] = sa;
        all[b] = sb;
        all[c] = sc;
        return all;
      };
      pushQuad(out, [
        faceCorner(half, bevel, a, sa, signs(-1)),
        faceCorner(half, bevel, a, sa, signs(1)),
        faceCorner(half, bevel, b, sb, signs(1)),
        faceCorner(half, bevel, b, sb, signs(-1)),
      ]);
    }
  }
  for (const signs of OCTANTS) {
    pushOutward(
      out,
      faceCorner(half, bevel, 0, signs[0], signs),
      faceCorner(half, bevel, 1, signs[1], signs),
      faceCorner(half, bevel, 2, signs[2], signs),
    );
  }
}

/**
 * Triangle soup of a box centred on the origin, bevelled by `bevel` metres: its six faces inset
 * by the bevel, twelve bevel strips and eight corner facets, every triangle wound outward.
 *
 * @param size - The box's extent along x, y and z.
 * @param bevel - How far the bevel cuts in from each edge, metres; 0 keeps sharp edges.
 * @returns Nine numbers per triangle.
 */
export function bevelledBoxPositions(size: Vec3, bevel: number): number[] {
  const half: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
  const out: number[] = [];
  pushFaces(out, half, bevel);
  if (bevel > 0) pushBevels(out, half, bevel);
  return out;
}

/** Narrows the geometry's x and z toward its axis, to `taper` at the bottom. */
function applyTaper(
  geometry: BufferGeometry,
  height: number,
  taper: number,
): void {
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const upShare = position.getY(index) / height + 0.5;
    const scale = taper + (1 - taper) * upShare;
    position.setX(index, position.getX(index) * scale);
    position.setZ(index, position.getZ(index) * scale);
  }
}

/**
 * Paints every vertex `colour`, darkening linearly toward the geometry's bottom by `gradient`.
 * Colours are stored in three's linear working space, as vertex colours expect.
 */
function paint(
  geometry: BufferGeometry,
  colour: number,
  gradient: number,
): void {
  const base = new Color(colour);
  geometry.computeBoundingBox();
  const bottom = geometry.boundingBox?.min.y ?? 0;
  const span = (geometry.boundingBox?.max.y ?? 0) - bottom || 1;
  const position = geometry.getAttribute("position");
  const colours = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const upShare = (position.getY(index) - bottom) / span;
    const light = 1 - gradient * (1 - upShare);
    colours.set([base.r * light, base.g * light, base.b * light], index * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
}

/**
 * A box part: optionally bevelled and tapered, painted, turned and placed, with flat normals and
 * no index or uvs so it merges with any other part.
 *
 * @param spec - Size, placement, colour and shaping.
 * @returns A new non-indexed geometry with `position`, `normal` and `color`.
 */
export function block(spec: BlockSpec): BufferGeometry {
  const bevel =
    (spec.chamfer ?? 0) *
    Math.min(spec.size[0], spec.size[1], spec.size[2]) *
    0.5;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(bevelledBoxPositions(spec.size, bevel), 3),
  );
  if (spec.taper !== undefined) applyTaper(geometry, spec.size[1], spec.taper);
  paint(geometry, spec.colour, spec.gradient ?? DEFAULT_GRADIENT);
  const turn = new Quaternion().setFromEuler(
    new Euler(...(spec.rotation ?? [0, 0, 0])),
  );
  geometry.applyMatrix4(
    new Matrix4().compose(new Vector3(...spec.at), turn, new Vector3(1, 1, 1)),
  );
  geometry.computeVertexNormals();
  return geometry;
}

/** Rotation that lays a y-axis cylinder along `axis`, far end toward +axis. */
function axisTurn(axis: RodSpec["axis"]): Euler {
  if (axis === "x") return new Euler(0, 0, -Math.PI / 2);
  if (axis === "z") return new Euler(Math.PI / 2, 0, 0);
  return new Euler(0, 0, 0);
}

/**
 * A faceted cylinder (or cone) part along one axis, painted and placed like {@link block}.
 *
 * @param spec - Radii, length, axis, placement and colour.
 * @returns A new non-indexed geometry with `position`, `normal` and `color`.
 */
export function rod(spec: RodSpec): BufferGeometry {
  const cylinder = new CylinderGeometry(
    spec.radius,
    spec.radiusStart ?? spec.radius,
    spec.length,
    spec.sides ?? ROD_SIDES,
    1,
  );
  const geometry = cylinder.toNonIndexed();
  cylinder.dispose();
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");
  geometry.applyMatrix4(
    new Matrix4().makeRotationFromEuler(axisTurn(spec.axis)),
  );
  paint(geometry, spec.colour, spec.gradient ?? DEFAULT_GRADIENT);
  geometry.translate(...spec.at);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Merges parts into one geometry and frees the parts.
 *
 * @param parts - Non-indexed geometries with identical attribute sets.
 * @returns The merged geometry.
 * @throws If the parts' attributes do not match.
 */
export function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error("mergeParts: parts have mismatched attributes");
  for (const part of parts) part.dispose();
  return merged;
}

/** Largest value of an 8-bit colour channel. */
const CHANNEL_MAX = 0xff;

/**
 * Scales an sRGB hex colour's channels by `factor`, clamped to the valid range.
 *
 * @param hex - The colour.
 * @param factor - Below 1 darkens, above 1 lightens.
 * @returns The scaled colour.
 */
export function shade(hex: number, factor: number): number {
  const channel = (shift: number): number =>
    Math.min(CHANNEL_MAX, Math.round(((hex >> shift) & CHANNEL_MAX) * factor));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
