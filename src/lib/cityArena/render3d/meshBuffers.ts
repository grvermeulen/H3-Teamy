/**
 * Growable vertex lists that the city builders fill and then turn into one indexed
 * `BufferGeometry`: positions, normals and UVs per vertex, three indices per triangle. Builders
 * work in three.js space, `(x, height, y)`, relative to their cell's corner.
 */
import {
  BufferAttribute,
  BufferGeometry,
  ShapeUtils,
  Vector2,
  type Vector3Tuple,
} from "three";
import type { Point } from "../world/projection";

/** Vertex and index lists for one geometry. */
export type MeshBuffers = {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
};

/** Maps a world point to the UV a flat surface is textured with there. */
export type UvMapping = (x: number, y: number) => [number, number];

/** The normal of a surface facing straight up. */
export const UP: Vector3Tuple = [0, 1, 0];

/**
 * Empty buffers.
 *
 * @returns Lists ready for {@link pushVertex} and {@link pushTriangleFacing}.
 */
export function createMeshBuffers(): MeshBuffers {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

/**
 * How many vertices the buffers hold.
 *
 * @param buffers - The buffers.
 * @returns The vertex count.
 */
export function vertexCount(buffers: MeshBuffers): number {
  return buffers.positions.length / 3;
}

/**
 * Appends one vertex.
 *
 * @param buffers - The buffers to grow.
 * @param position - Three.js position.
 * @param normal - Unit normal.
 * @param uv - Texture coordinate.
 * @returns The new vertex's index.
 */
export function pushVertex(
  buffers: MeshBuffers,
  position: Vector3Tuple,
  normal: Vector3Tuple,
  uv: readonly [number, number],
): number {
  buffers.positions.push(position[0], position[1], position[2]);
  buffers.normals.push(normal[0], normal[1], normal[2]);
  buffers.uvs.push(uv[0], uv[1]);
  return vertexCount(buffers) - 1;
}

/** One component of a vertex's position. */
function coordinate(
  buffers: MeshBuffers,
  vertex: number,
  axis: number,
): number {
  return buffers.positions[vertex * 3 + axis];
}

/**
 * Appends a triangle wound so its front face looks along `facing`: three.js draws the
 * counter-clockwise side, so the corners are swapped when their order points the other way.
 *
 * @param buffers - The buffers holding the three vertices.
 * @param corners - The vertex indices, in any order.
 * @param facing - The direction the visible side must face.
 */
export function pushTriangleFacing(
  buffers: MeshBuffers,
  corners: readonly [number, number, number],
  facing: Vector3Tuple,
): void {
  const [a, b, c] = corners;
  const edge = (to: number, axis: number): number =>
    coordinate(buffers, to, axis) - coordinate(buffers, a, axis);
  const cross: Vector3Tuple = [
    edge(b, 1) * edge(c, 2) - edge(b, 2) * edge(c, 1),
    edge(b, 2) * edge(c, 0) - edge(b, 0) * edge(c, 2),
    edge(b, 0) * edge(c, 1) - edge(b, 1) * edge(c, 0),
  ];
  const dot =
    cross[0] * facing[0] + cross[1] * facing[1] + cross[2] * facing[2];
  if (dot < 0) buffers.indices.push(a, c, b);
  else buffers.indices.push(a, b, c);
}

/**
 * Triangulates a world polygon into the buffers as one planar surface: each corner raised to
 * `heightOf` it, every vertex given `normal`, and every triangle wound to face along it. Works for
 * either winding and for concave rings (earcut via `ShapeUtils`).
 *
 * @param buffers - The buffers to grow.
 * @param ring - The outline in world metres, first point not repeated.
 * @param heightOf - Metres above the ground at a corner; must describe a plane with `normal`.
 * @param normal - The surface's unit normal.
 * @param origin - The world point that is the buffers' local zero.
 * @param uvOf - The UV at a world point.
 */
export function pushPolygonSurface(
  buffers: MeshBuffers,
  ring: readonly Point[],
  heightOf: (point: Point) => number,
  normal: Vector3Tuple,
  origin: Point,
  uvOf: UvMapping,
): void {
  const contour = ring.map(([x, y]) => new Vector2(x, y));
  const faces = ShapeUtils.triangulateShape(contour, []);
  const first = vertexCount(buffers);
  for (const { x, y } of contour) {
    const position: Vector3Tuple = [
      x - origin[0],
      heightOf([x, y]),
      y - origin[1],
    ];
    pushVertex(buffers, position, normal, uvOf(x, y));
  }
  for (const [a, b, c] of faces) {
    pushTriangleFacing(buffers, [first + a, first + b, first + c], normal);
  }
}

/**
 * Triangulates a flat world polygon at a height, facing up, into the buffers.
 *
 * @param buffers - The buffers to grow.
 * @param ring - The outline in world metres, first point not repeated.
 * @param height - Metres above the ground.
 * @param origin - The world point that is the buffers' local zero.
 * @param uvOf - The UV at a world point.
 */
export function pushFlatPolygon(
  buffers: MeshBuffers,
  ring: readonly Point[],
  height: number,
  origin: Point,
  uvOf: UvMapping,
): void {
  pushPolygonSurface(buffers, ring, () => height, UP, origin, uvOf);
}

/** The largest vertex index a 16-bit index buffer holds. */
const MAX_UINT16_INDEX = 0xffff;

/**
 * A float attribute over a copy of `values`. `TypedArray.set` copies a plain number list about
 * twice as fast as the typed array constructor three's `Float32BufferAttribute` uses, and a
 * cell's geometry is mostly such copies.
 *
 * @param values - The values, `itemSize` per vertex.
 * @param itemSize - Components per vertex.
 * @returns A new attribute owning its own `Float32Array`.
 */
export function float32Attribute(
  values: readonly number[],
  itemSize: number,
): BufferAttribute {
  const array = new Float32Array(values.length);
  array.set(values);
  return new BufferAttribute(array, itemSize);
}

/**
 * An index attribute over a copy of `indices`: 16-bit while every index fits, else 32-bit.
 *
 * @param indices - Three per triangle.
 * @param vertexCount - The geometry's vertices, which bounds every index.
 * @returns A new index attribute.
 */
export function indexAttribute(
  indices: readonly number[],
  vertexCount: number,
): BufferAttribute {
  const array =
    vertexCount - 1 > MAX_UINT16_INDEX
      ? new Uint32Array(indices.length)
      : new Uint16Array(indices.length);
  array.set(indices);
  return new BufferAttribute(array, 1);
}

/**
 * The buffers as an indexed geometry, optionally with a white `color` attribute for materials
 * that tint by vertex colour.
 *
 * @param buffers - The filled buffers; an empty set gives an empty geometry.
 * @param withWhiteColour - Adds `color` = (1, 1, 1) on every vertex.
 * @returns A new geometry with a bounding sphere.
 */
export function toGeometry(
  buffers: MeshBuffers,
  withWhiteColour = false,
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", float32Attribute(buffers.positions, 3));
  geometry.setAttribute("normal", float32Attribute(buffers.normals, 3));
  geometry.setAttribute("uv", float32Attribute(buffers.uvs, 2));
  if (withWhiteColour) {
    const white = new Float32Array(buffers.positions.length).fill(1);
    geometry.setAttribute("color", new BufferAttribute(white, 3));
  }
  geometry.setIndex(indexAttribute(buffers.indices, vertexCount(buffers)));
  geometry.computeBoundingSphere();
  return geometry;
}
