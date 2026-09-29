/**
 * Stand-ins for the packed Kenney cars, built in code for tests (no network, no files): every
 * kind is the same boxy car in the packed frame — x forward, y up, z to the right, on the ground
 * — with a body split into roles (paint, detail, lamps, and on the police car two roof lenses)
 * as `GLTFLoader` would give it, four wheel meshes, and a manifest entry to match.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import {
  CAR_KINDS,
  CAR_WHEEL_NODES,
  type CarEntry,
  type CarKind,
  type CarManifest,
  type CarRole,
} from "../../carManifest";
import { assembleCarAssets, type CarAssets } from "../carAssets";

/** The fixture car's length, height and width, wheels included. */
export const FIXTURE_CAR_SIZE: [number, number, number] = [2.6, 1.3, 1.5];
/** Its wheels' radius and width. */
const WHEEL = { radius: 0.3, width: 0.3, axle: 0.8, track: 0.6 };
/** The grey every fixture vertex is shaded. */
const SHADE = 0.8;

/** A geometry with every vertex in the fixture's grey. */
function shaded(geometry: BufferGeometry): BufferGeometry {
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute(
    "color",
    new Float32BufferAttribute(new Array(count * 3).fill(SHADE), 3),
  );
  return geometry;
}

/** A box between two points, shaded. */
function box(
  from: [number, number, number],
  to: [number, number, number],
): BufferGeometry {
  const geometry = new BoxGeometry(
    to[0] - from[0],
    to[1] - from[1],
    to[2] - from[2],
  );
  geometry.translate(
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2,
  );
  return shaded(geometry);
}

/** A mesh as `GLTFLoader` names it: its material carries the role. */
function roleMesh(role: CarRole, geometry: BufferGeometry): Mesh {
  const material = new MeshStandardMaterial();
  material.name = role;
  return new Mesh(geometry, material);
}

/** The body's pieces by role: a painted box, a sill and roof box, lamps at both ends, roof lenses. */
function bodyOf(lenses: boolean): Group {
  const body = new Group();
  body.userData.name = "body";
  body.add(
    roleMesh("paint", box([-1.3, 0.35, -0.75], [1.3, 1.1, 0.75])),
    roleMesh("detail", box([-1.2, 0.25, -0.7], [1.2, 0.35, 0.7])),
    roleMesh("detail", box([-0.5, 1.1, -0.5], [0.5, 1.3, 0.5])),
    roleMesh("head", box([1.28, 0.8, -0.6], [1.3, 0.9, -0.3])),
    roleMesh("head", box([1.28, 0.8, 0.3], [1.3, 0.9, 0.6])),
    roleMesh("tail", box([-1.3, 0.8, -0.6], [-1.28, 0.9, 0.6])),
  );
  if (lenses)
    body.add(
      roleMesh("lens-left", box([-0.1, 1.1, -0.4], [0.1, 1.3, -0.1])),
      roleMesh("lens-right", box([-0.1, 1.1, 0.1], [0.1, 1.3, 0.4])),
    );
  return body;
}

/** Where each wheel's middle is. */
function wheelAt(
  node: (typeof CAR_WHEEL_NODES)[number],
): [number, number, number] {
  const along = node.includes("front") ? WHEEL.axle : -WHEEL.axle;
  const across = node.includes("left") ? -WHEEL.track : WHEEL.track;
  return [along, WHEEL.radius, across];
}

/** A parsed car: its body and four wheels. */
export function fixtureCarScene(lenses = false): Object3D {
  const scene = new Group();
  scene.add(bodyOf(lenses));
  for (const node of CAR_WHEEL_NODES) {
    const geometry = new CylinderGeometry(
      WHEEL.radius,
      WHEEL.radius,
      WHEEL.width,
      8,
    );
    geometry.rotateX(Math.PI / 2);
    const wheel = roleMesh("detail", shaded(geometry));
    wheel.userData.name = node;
    wheel.position.set(...wheelAt(node));
    scene.add(wheel);
  }
  return scene;
}

/** The manifest entry of the fixture car for one kind. */
function entryOf(kind: CarKind): CarEntry {
  return {
    file: `${kind}.glb`,
    source: "fixture",
    size: FIXTURE_CAR_SIZE,
    paint: 0xe76047,
    wheels: CAR_WHEEL_NODES.map((node) => ({
      node,
      at: wheelAt(node),
      radius: WHEEL.radius,
      width: WHEEL.width,
      steers: node.includes("front"),
    })),
    lamps: [
      { at: [1.3, 0.85, -0.45], facing: 1, tail: false },
      { at: [1.3, 0.85, 0.45], facing: 1, tail: false },
      { at: [-1.3, 0.85, -0.45], facing: -1, tail: true },
      { at: [-1.3, 0.85, 0.45], facing: -1, tail: true },
    ],
    plates: {
      front: { face: 1.3, height: 0.5 },
      rear: kind === "tractor" ? null : { face: -1.3, height: 0.5 },
    },
    livery:
      kind === "police" ? { x: [-0.4, 0.4], y: [0.5, 1.0], side: 0.75 } : null,
  };
}

/** A manifest naming every kind, all fixture files. */
export function fixtureCarManifest(): CarManifest {
  return {
    cars: Object.fromEntries(
      CAR_KINDS.map((kind) => [kind, entryOf(kind)]),
    ) as CarManifest["cars"],
  };
}

/** The fixture cars, assembled the way the 3D view assembles the real ones. */
export function fixtureCarAssets(): CarAssets {
  const manifest = fixtureCarManifest();
  const files = new Map(
    CAR_KINDS.map((kind) => [
      `${kind}.glb`,
      { scene: fixtureCarScene(kind === "police") },
    ]),
  );
  return assembleCarAssets(manifest, files);
}
