import {
  Mesh,
  Vector3,
  type BufferAttribute,
  type Object3D,
  type PerspectiveCamera,
} from "three";

/** The on-screen box of what a camera sees of some meshes, normalised device coordinates. */
export type ScreenBox = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

/** Samples per triangle edge: enough to find where an edge leaves the screen to a few pixels. */
const EDGE_SAMPLES = 64;

/** Grows `box` by a camera-space point if it projects inside the screen. */
function include(
  box: ScreenBox,
  camera: PerspectiveCamera,
  point: Vector3,
): void {
  const projected = point.clone().applyMatrix4(camera.projectionMatrix);
  if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) return;
  box.minX = Math.min(box.minX, projected.x);
  box.maxX = Math.max(box.maxX, projected.x);
  box.minY = Math.min(box.minY, projected.y);
  box.maxY = Math.max(box.maxY, projected.y);
}

/** Samples one triangle edge, cut at the near plane, into `box`. */
function includeEdge(
  box: ScreenBox,
  camera: PerspectiveCamera,
  a: Vector3,
  b: Vector3,
): void {
  const near = -camera.near;
  if (a.z > near && b.z > near) return;
  const cut = (): Vector3 =>
    new Vector3().lerpVectors(a, b, (near - a.z) / (b.z - a.z));
  const from = a.z > near ? cut() : a;
  const to = b.z > near ? cut() : b;
  for (let step = 0; step <= EDGE_SAMPLES; step++)
    include(
      box,
      camera,
      new Vector3().lerpVectors(from, to, step / EDGE_SAMPLES),
    );
}

/**
 * Where the visible meshes under `root` land on the screen of a camera at the origin looking down
 * −Z (as the first-person hands' pass camera sees its children): every triangle edge is cut at the
 * near plane and sampled, and only the samples inside the screen count, so an arm that runs off
 * the edge ends the box at the edge.
 *
 * @param root - The meshes to measure, in the camera's space (e.g. the view model on the camera).
 * @param camera - The camera, at the origin and unrotated, its projection up to date.
 * @returns The box, empty (min above max) when nothing is on screen.
 */
export function screenFootprint(
  root: Object3D,
  camera: PerspectiveCamera,
): ScreenBox {
  const box: ScreenBox = { minX: 1, maxX: -1, minY: 1, maxY: -1 };
  camera.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  root.traverseVisible((node) => {
    if (!(node instanceof Mesh)) return;
    const position = node.geometry.getAttribute("position") as BufferAttribute;
    const index = node.geometry.index;
    const count = index ? index.count : position.count;
    const vertex = (at: number): Vector3 =>
      new Vector3()
        .fromBufferAttribute(position, index ? index.getX(at) : at)
        .applyMatrix4(node.matrixWorld)
        .applyMatrix4(camera.matrixWorldInverse);
    for (let at = 0; at < count; at += 3) {
      const corners = [vertex(at), vertex(at + 1), vertex(at + 2)];
      for (let edge = 0; edge < 3; edge++)
        includeEdge(box, camera, corners[edge], corners[(edge + 1) % 3]);
    }
  });
  return box;
}
