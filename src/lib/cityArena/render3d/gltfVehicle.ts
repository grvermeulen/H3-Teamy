/**
 * A vehicle built from its Kenney Car Kit model (spec §8), to the procedural models' contract
 * (`VehicleModel`): the packed body scaled to the simulation's `lengthOf × widthOf` and the kind's
 * height, facing +X with its origin at the footprint centre on the ground, drawn as one mesh with a
 * group per material — the paint (tinted `bodyColour(kind, colour)`, the Kit's shading kept in
 * its vertex colours), everything else in its baked colours with our Dutch plates and the police
 * livery merged in, the headlamps, and the tail lamps the brakes light. The wheels spin and steer
 * as the procedural ones do; the police car's light-bar lenses flash; a wreck chars.
 *
 * Geometry is built once per kind and shared by every vehicle of it (`VehicleModel.shared`), so
 * a vehicle costs a mesh, a material array and its lamps' flares.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Object3D,
  type Material,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CarRole } from "../carManifest";
import { lengthOf, widthOf } from "../sim/vehicle";
import { CAR_BODY_NODE, carNode, type CarAsset } from "./carAssets";
import { bodyColour, lensMaterial, vehicleHeight } from "./vehicleLooks";
import { lampAt, lampMaterial, rigLamps, type Lamp } from "./vehicleLamps";
import type { LightBarRig, VehicleModel, WheelRig } from "./vehicleModels";
import {
  detailMaterial,
  shadedPaintMaterial,
  tintVertices,
} from "./vehicleParts";
import {
  HEADLIGHT,
  POLICE_STRIPE_HEIGHT_M,
  TAIL_LIGHT,
  addPoliceStripes,
} from "./vehicleShapes";
import { PLATE_LOOKS, addPlateAt } from "./vehicleTrim";

/** The body's draw groups, in the order of its materials. */
const BODY_GROUPS = ["paint", "detail", "head", "tail"] as const;
/** The attributes every merged piece keeps, so the Kit's and ours merge. */
const KEPT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "position",
  "normal",
  "color",
]);
/** Floats per vertex of each kept attribute. */
const XYZ = 3;

/** How much a kind's packed model is stretched along, up and across. */
type Scale = readonly [number, number, number];

/** A wheel's shared geometry, where its middle sits and how it turns. */
type WheelPart = {
  geometry: BufferGeometry;
  at: readonly [number, number, number];
  radius: number;
  steers: boolean;
};

/** Everything a kind's vehicles share, built once from its asset. */
type CarParts = {
  body: BufferGeometry;
  wheels: WheelPart[];
  lamps: Lamp[];
  lenses: { left: BufferGeometry; right: BufferGeometry } | null;
  shared: Set<BufferGeometry>;
};

/** Each loaded kind's parts, built on its first vehicle. */
const partsCache = new Map<CarAsset, CarParts>();

/** How much a kind's model is stretched to the simulation's footprint and the kind's height. */
function scaleOf(asset: CarAsset): Scale {
  const [length, height, width] = asset.entry.size;
  return [
    lengthOf(asset.kind) / length,
    vehicleHeight(asset.kind) / height,
    widthOf(asset.kind) / width,
  ];
}

/** An empty piece with the kept attributes, for a draw group a model has nothing for. */
function emptyGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const name of KEPT_ATTRIBUTES)
    geometry.setAttribute(name, new Float32BufferAttribute([], XYZ));
  geometry.setIndex([]);
  return geometry;
}

/** A Kit piece stretched by `scale`, with the kept attributes only. */
function stretched(source: BufferGeometry, scale: Scale): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", source.getAttribute("position").clone());
  geometry.setAttribute("color", source.getAttribute("color").clone());
  if (source.index) geometry.setIndex(source.index.clone());
  geometry.scale(scale[0], scale[1], scale[2]);
  geometry.computeVertexNormals();
  return geometry;
}

/** The body's pieces of one role, stretched. */
function rolePieces(
  asset: CarAsset,
  role: CarRole,
  scale: Scale,
): BufferGeometry[] {
  const pieces: BufferGeometry[] = [];
  carNode(asset.scene, CAR_BODY_NODE)?.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh && (mesh.material as Material).name === role)
      pieces.push(stretched(mesh.geometry, scale));
  });
  return pieces;
}

/** Our parts for the detail group: the Dutch plates and, on the police car, the livery. */
function detailExtras(asset: CarAsset, scale: Scale): BufferGeometry[] {
  const extras: BufferGeometry[] = [];
  const kit = {
    tint(geometry: BufferGeometry, hex: number): void {
      tintVertices(geometry, hex);
      for (const name of Object.keys(geometry.attributes))
        if (!KEPT_ATTRIBUTES.has(name)) geometry.deleteAttribute(name);
      extras.push(geometry);
    },
  };
  const { plates, livery } = asset.entry;
  for (const [end, plate] of [
    [1, plates.front],
    [-1, plates.rear],
  ] as const)
    if (plate)
      addPlateAt(
        kit,
        { end, face: plate.face * scale[0], height: plate.height * scale[1] },
        PLATE_LOOKS.modern,
      );
  if (livery) {
    const middle = ((livery.y[0] + livery.y[1]) / 2) * scale[1];
    const half = POLICE_STRIPE_HEIGHT_M / 2;
    addPoliceStripes(kit, {
      x: [livery.x[0] * scale[0], livery.x[1] * scale[0]],
      y: [middle - half, middle + half],
      side: livery.side * scale[2],
    });
  }
  return extras;
}

/** Merges pieces into one and frees them; an empty list is an empty piece. */
function mergePieces(pieces: BufferGeometry[]): BufferGeometry {
  if (pieces.length === 0) return emptyGeometry();
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  return merged;
}

/** The body: one piece per draw group, in {@link BODY_GROUPS} order. */
function bodyGeometry(asset: CarAsset, scale: Scale): BufferGeometry {
  const groups = BODY_GROUPS.map((role) => {
    const pieces = rolePieces(asset, role, scale);
    if (role === "detail") pieces.push(...detailExtras(asset, scale));
    return mergePieces(pieces);
  });
  const body = mergeGeometries(groups, true);
  for (const group of groups) group.dispose();
  return body;
}

/** The wheels, stretched round (by the height's scale) and across; a shared mesh stays shared. */
function wheelParts(asset: CarAsset, scale: Scale): WheelPart[] {
  const round: Scale = [scale[1], scale[1], scale[2]];
  const made = new Map<BufferGeometry, BufferGeometry>();
  return asset.entry.wheels.map((wheel) => {
    const mesh = carNode(asset.scene, wheel.node) as Mesh;
    const geometry = made.get(mesh.geometry) ?? stretched(mesh.geometry, round);
    made.set(mesh.geometry, geometry);
    return {
      geometry,
      at: [
        wheel.at[0] * scale[0],
        wheel.at[1] * scale[1],
        wheel.at[2] * scale[2],
      ],
      radius: wheel.radius * scale[1],
      steers: wheel.steers,
    };
  });
}

/** The police light bar's two lenses, or null for a car without them. */
function lensParts(asset: CarAsset, scale: Scale): CarParts["lenses"] {
  const left = rolePieces(asset, "lens-left", scale);
  const right = rolePieces(asset, "lens-right", scale);
  if (left.length === 0 || right.length === 0) return null;
  return { left: mergePieces(left), right: mergePieces(right) };
}

/** Everything a kind's vehicles share, built on first use. */
function partsOf(asset: CarAsset): CarParts {
  const cached = partsCache.get(asset);
  if (cached) return cached;
  const scale = scaleOf(asset);
  const lamps = asset.entry.lamps.map((lamp) =>
    lampAt(
      [lamp.at[0] * scale[0], lamp.at[1] * scale[1], lamp.at[2] * scale[2]],
      lamp.facing,
      lamp.tail,
    ),
  );
  const parts: CarParts = {
    body: bodyGeometry(asset, scale),
    wheels: wheelParts(asset, scale),
    lamps,
    lenses: lensParts(asset, scale),
    shared: new Set(),
  };
  parts.shared.add(parts.body);
  for (const wheel of parts.wheels) parts.shared.add(wheel.geometry);
  if (parts.lenses) parts.shared.add(parts.lenses.left).add(parts.lenses.right);
  partsCache.set(asset, parts);
  return parts;
}

/** Puts a wheel under `root`, spinning inside a pivot that steers. */
function mountWheel(root: Group, wheel: WheelPart): WheelRig {
  const pivot = new Object3D();
  pivot.name = "wheel-pivot";
  pivot.position.set(wheel.at[0], wheel.at[1], wheel.at[2]);
  const spinner = new Mesh(wheel.geometry, detailMaterial());
  spinner.name = "wheel";
  pivot.add(spinner);
  root.add(pivot);
  return { pivot, spinner, radius: wheel.radius, steers: wheel.steers };
}

/** Puts the two light-bar lenses under `root`, unlit. */
function mountLenses(
  root: Group,
  lenses: NonNullable<CarParts["lenses"]>,
): LightBarRig {
  const lens = (side: "left" | "right"): Mesh => {
    const mesh = new Mesh(lenses[side], lensMaterial(side, false));
    mesh.name = `light-bar-${side}`;
    root.add(mesh);
    return mesh;
  };
  return { left: lens("left"), right: lens("right") };
}

/**
 * Builds a vehicle from its kind's Kit model.
 *
 * @param asset - The kind's loaded model.
 * @param colour - `VehicleState.colour`; ignored by kinds with a fixed livery.
 * @returns The model with its wheels, lamps and, on the police car, the light bar.
 */
export function buildGltfVehicleModel(
  asset: CarAsset,
  colour: number,
): VehicleModel {
  const parts = partsOf(asset);
  const root = new Group();
  root.name = `vehicle-${asset.kind}`;
  const body = new Mesh(parts.body, [
    shadedPaintMaterial(bodyColour(asset.kind, colour)),
    detailMaterial(),
    lampMaterial(HEADLIGHT),
    lampMaterial(TAIL_LIGHT),
  ]);
  body.name = "body";
  root.add(body);
  const lamps = rigLamps(body, parts.lamps);
  if (lamps.flares) root.add(lamps.flares);
  const wheels = parts.wheels.map((wheel) => mountWheel(root, wheel));
  const lightBar = parts.lenses ? mountLenses(root, parts.lenses) : null;
  return { root, wheels, lightBar, turret: null, lamps, shared: parts.shared };
}

/**
 * Frees the geometry every Kit-built kind shares and forgets it; the next vehicle of a kind
 * builds it again. Call with the rest of the view's shared assets.
 */
export function disposeGltfVehicleParts(): void {
  for (const parts of partsCache.values())
    for (const geometry of parts.shared) geometry.dispose();
  partsCache.clear();
}
