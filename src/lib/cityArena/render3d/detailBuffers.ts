/**
 * Vertex-coloured buffers for the city's small detail — sills, balconies, awnings, fascia boards,
 * chimneys, dormers, kerbs, bikes, bins and hedges. Everything a cell adds here merges into one
 * geometry drawn with one shared vertex-coloured material, so all of a cell's detail costs one
 * draw call. Builders work in the cell's local frame, `(x, height, y)` from its corner.
 */
import { BufferGeometry, Color, type Vector3Tuple } from "three";
import { float32Attribute, indexAttribute } from "./meshBuffers";

/** Positions, normals and linear colours per vertex, three indices per triangle. */
export type DetailBuffers = {
  positions: number[];
  normals: number[];
  colours: number[];
  indices: number[];
};

/** An orthonormal frame for a box: `u` along it, `v` up it, `w` across it (all unit length). */
export type BoxAxes = { u: Vector3Tuple; v: Vector3Tuple; w: Vector3Tuple };

/** An oriented box: its centre, its axes and its full extent along each. */
export type DetailBox = {
  centre: Vector3Tuple;
  axes: BoxAxes;
  size: Vector3Tuple;
  /** sRGB hex colour. */
  colour: number;
  /** Leaves the face under the box out, for pieces standing on something. */
  openBottom?: boolean;
};

/** The upright axes: along +X, up +Y, across +Z. */
export const UPRIGHT_AXES: BoxAxes = {
  u: [1, 0, 0],
  v: [0, 1, 0],
  w: [0, 0, 1],
};

/** Linear colours by sRGB hex, converted once. */
const LINEAR_COLOURS = new Map<number, Vector3Tuple>();

/** An sRGB hex colour in three's linear working space, cached. */
function linear(hex: number): Vector3Tuple {
  const cached = LINEAR_COLOURS.get(hex);
  if (cached) return cached;
  const colour = new Color(hex);
  const value: Vector3Tuple = [colour.r, colour.g, colour.b];
  LINEAR_COLOURS.set(hex, value);
  return value;
}

/**
 * Empty detail buffers.
 *
 * @returns Lists ready for {@link pushDetailQuad} and {@link pushDetailBox}.
 */
export function createDetailBuffers(): DetailBuffers {
  return { positions: [], normals: [], colours: [], indices: [] };
}

/**
 * How many vertices the buffers hold.
 *
 * @param buffers - The buffers.
 * @returns The vertex count.
 */
export function detailVertexCount(buffers: DetailBuffers): number {
  return buffers.positions.length / 3;
}

/**
 * Appends a flat quad of four corners (in order around its rim) facing `normal`: two triangles
 * wound so the side `normal` points to is the visible one.
 *
 * @param buffers - The buffers to grow.
 * @param corners - The corners, local metres.
 * @param normal - The unit normal of the visible side.
 * @param colour - sRGB hex colour.
 */
export function pushDetailQuad(
  buffers: DetailBuffers,
  corners: readonly [Vector3Tuple, Vector3Tuple, Vector3Tuple, Vector3Tuple],
  normal: Vector3Tuple,
  colour: number,
): void {
  const first = detailVertexCount(buffers);
  const [r, g, b] = linear(colour);
  const { positions, normals, colours } = buffers;
  for (const corner of corners) {
    positions.push(corner[0], corner[1], corner[2]);
    normals.push(normal[0], normal[1], normal[2]);
    colours.push(r, g, b);
  }
  const [a, p, c] = corners;
  const [e1x, e1y, e1z] = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const [e2x, e2y, e2z] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const facing =
    (e1y * e2z - e1z * e2y) * normal[0] +
    (e1z * e2x - e1x * e2z) * normal[1] +
    (e1x * e2y - e1y * e2x) * normal[2];
  if (facing >= 0)
    buffers.indices.push(
      first,
      first + 1,
      first + 2,
      first,
      first + 2,
      first + 3,
    );
  else
    buffers.indices.push(
      first,
      first + 2,
      first + 1,
      first,
      first + 3,
      first + 2,
    );
}

/** The eight corners of a box, indexed by `(u > 0) · 4 + (v > 0) · 2 + (w > 0)`. */
function boxCorners(box: DetailBox): Vector3Tuple[] {
  const { centre, axes, size } = box;
  const corners: Vector3Tuple[] = [];
  for (const su of [-0.5, 0.5])
    for (const sv of [-0.5, 0.5])
      for (const sw of [-0.5, 0.5]) {
        const [a, b, c] = [su * size[0], sv * size[1], sw * size[2]];
        corners.push([
          centre[0] + axes.u[0] * a + axes.v[0] * b + axes.w[0] * c,
          centre[1] + axes.u[1] * a + axes.v[1] * b + axes.w[1] * c,
          centre[2] + axes.u[2] * a + axes.v[2] * b + axes.w[2] * c,
        ]);
      }
  return corners;
}

/** Each face of a box: the axis it faces along, its sign, and its corners around its rim. */
const BOX_FACES: readonly {
  axis: keyof BoxAxes;
  sign: 1 | -1;
  corners: readonly [number, number, number, number];
}[] = [
  { axis: "u", sign: -1, corners: [0, 1, 3, 2] },
  { axis: "u", sign: 1, corners: [4, 5, 7, 6] },
  { axis: "w", sign: -1, corners: [0, 4, 6, 2] },
  { axis: "w", sign: 1, corners: [1, 5, 7, 3] },
  { axis: "v", sign: 1, corners: [2, 3, 7, 6] },
  { axis: "v", sign: -1, corners: [0, 1, 5, 4] },
];

/**
 * Appends an oriented box: six faces (five with `openBottom`), each with its own four vertices
 * and outward normal, so the flat-lit faces read as crisp edges.
 *
 * @param buffers - The buffers to grow.
 * @param box - Centre, frame, size and colour.
 */
export function pushDetailBox(buffers: DetailBuffers, box: DetailBox): void {
  const corners = boxCorners(box);
  for (const face of BOX_FACES) {
    if (box.openBottom && face.axis === "v" && face.sign < 0) continue;
    const axis = box.axes[face.axis];
    const normal: Vector3Tuple = [
      axis[0] * face.sign,
      axis[1] * face.sign,
      axis[2] * face.sign,
    ];
    const [a, b, c, d] = face.corners;
    pushDetailQuad(
      buffers,
      [corners[a], corners[b], corners[c], corners[d]],
      normal,
      box.colour,
    );
  }
}

/**
 * Upright axes turned to a horizontal direction: `u` along it, `v` up, `w` a quarter turn from
 * it (to its right in the map's (x, y), which is +Z-ward for a +X direction).
 *
 * @param direction - A horizontal unit direction in the map's (x, y).
 * @returns The frame.
 */
export function axesAlong(direction: readonly [number, number]): BoxAxes {
  const [dx, dy] = direction;
  return { u: [dx, 0, dy], v: [0, 1, 0], w: [-dy, 0, dx] };
}

/**
 * The buffers as an indexed geometry with `position`, `normal` and `color`.
 *
 * @param buffers - The filled buffers; an empty set gives an empty geometry.
 * @returns A new geometry with a bounding sphere.
 */
export function detailGeometry(buffers: DetailBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", float32Attribute(buffers.positions, 3));
  geometry.setAttribute("normal", float32Attribute(buffers.normals, 3));
  geometry.setAttribute("color", float32Attribute(buffers.colours, 3));
  geometry.setIndex(
    indexAttribute(buffers.indices, detailVertexCount(buffers)),
  );
  geometry.computeBoundingSphere();
  return geometry;
}
