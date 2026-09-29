/**
 * Procedural low-poly models of every vehicle kind (spec §6.7), read as the 3D versions of the 2D
 * sprites: the same body colours, the olive tank, the green tractor with yellow rims, the white
 * police car in Dutch blue-and-orange livery, the white-and-blue city bus.
 *
 * A model is one merged body mesh (a draw group per material), four wheel meshes that spin and
 * steer, the lamps' flares, and — for the police car and the tank — a light bar or a turret. Its frame: local forward
 * +X, origin at the footprint centre on the ground, exactly `lengthOf × widthOf` of the simulation.
 *
 * Once the Kenney Car Kit has loaded, the kinds it covers are built from it instead
 * (`gltfVehicle.ts`), to the same contract; these procedural models draw until then, and always
 * for the bus, the oldtimer and the tank.
 */
import { Group, Mesh, Object3D, type BufferGeometry } from "three";
import { isCarKind } from "../carManifest";
import type { VehicleKind } from "../sim/types";
import { lengthOf, widthOf } from "../sim/vehicle";
import type { CarAssets } from "./carAssets";
import { buildGltfVehicleModel } from "./gltfVehicle";
import { bodyColour, lensMaterial, vehicleHeight } from "./vehicleLooks";
import {
  lampMaterial,
  lampOf,
  rigLamps,
  type Lamp,
  type LampRig,
} from "./vehicleLamps";
import {
  createPartSet,
  detailMaterial,
  paintMaterial,
  slab,
  wheelGeometry,
  type PartSet,
} from "./vehicleParts";
import {
  addParts,
  PASSENGER_SHAPES,
  SIDES,
  type Axle,
  type Kit,
  type Shape,
  type ShapeRig,
} from "./vehicleShapes";
import { HEAVY_SHAPES } from "./vehicleShapesHeavy";

export {
  VEHICLE_HEIGHT_M,
  bodyColour,
  lensMaterial,
  vehicleHeight,
} from "./vehicleLooks";

/** A wheel that spins about its axle (`spinner`) inside a pivot that steers. */
export type WheelRig = {
  pivot: Object3D;
  spinner: Mesh;
  radius: number;
  steers: boolean;
};

/** The two lenses of the police light bar. */
export type LightBarRig = { left: Mesh; right: Mesh };

/** A built vehicle and its moving parts. */
export type VehicleModel = {
  root: Group;
  wheels: WheelRig[];
  lightBar: LightBarRig | null;
  turret: Object3D | null;
  lamps: LampRig;
  /**
   * Geometry the model shares with every other vehicle of its kind (a Kit model's): freeing the
   * vehicle leaves it. Absent for a procedural model, which owns all of its geometry.
   */
  shared?: ReadonlySet<BufferGeometry>;
};

/** Every kind's shape. */
const SHAPES: Record<VehicleKind, Shape> = {
  ...PASSENGER_SHAPES,
  ...HEAVY_SHAPES,
};

/** Size of a light-bar lens along the body. */
const LENS_LENGTH_M = 0.3;
/** Size of a light-bar lens across the body. */
const LENS_WIDTH_M = 0.55;
/** Distance of each lens's centre from the centre line. */
const LENS_OFFSET_M = 0.29;

/** A kit adding to `parts`, painted in the vehicle's body colour; head and tail lamps go in `lamps`. */
function createKit(
  kind: VehicleKind,
  colour: number,
  parts: PartSet,
  lamps: Lamp[],
): Kit {
  const paint = paintMaterial(bodyColour(kind, colour));
  const detail = detailMaterial();
  return {
    length: lengthOf(kind),
    width: widthOf(kind),
    height: vehicleHeight(kind),
    paint: (geometry) => parts.add(paint, geometry),
    tint: (geometry, hex) => parts.add(detail, geometry, hex),
    glow: (geometry, hex) => {
      const lamp = lampOf(geometry, hex);
      if (lamp) lamps.push(lamp);
      parts.add(lampMaterial(hex), geometry);
    },
    assemble: (name, list) => {
      const own = createPartSet();
      addParts(createKit(kind, colour, own, []), list);
      return own.toMesh(name);
    },
  };
}

/** Puts an axle's two wheels under `root`, each spinning inside a steering pivot. */
function mountAxle(root: Group, axle: Axle): WheelRig[] {
  const geometry = wheelGeometry(axle.wheel);
  return SIDES.map((side) => {
    const pivot = new Object3D();
    pivot.name = "wheel-pivot";
    pivot.position.set(axle.x, axle.wheel.radius, side * axle.track);
    const spinner = new Mesh(geometry, detailMaterial());
    spinner.name = "wheel";
    pivot.add(spinner);
    root.add(pivot);
    return {
      pivot,
      spinner,
      radius: axle.wheel.radius,
      steers: axle.steers,
    };
  });
}

/** Puts the two light-bar lenses under `root`, unlit. */
function mountLightBar(
  root: Group,
  spot: NonNullable<ShapeRig["lightBar"]>,
): LightBarRig {
  const { x, y } = spot;
  const lens = (side: "left" | "right", z: number): Mesh => {
    const mesh = new Mesh(
      slab({
        x: [x - LENS_LENGTH_M / 2, x + LENS_LENGTH_M / 2],
        y,
        width: LENS_WIDTH_M,
        z,
      }),
      lensMaterial(side, false),
    );
    mesh.name = `light-bar-${side}`;
    root.add(mesh);
    return mesh;
  };
  return {
    left: lens("left", -LENS_OFFSET_M),
    right: lens("right", LENS_OFFSET_M),
  };
}

/**
 * Builds a vehicle of one kind and colour: from the Kenney Car Kit when `cars` has loaded and
 * covers the kind, procedurally otherwise.
 *
 * @param kind - The vehicle kind.
 * @param colour - `VehicleState.colour`; ignored by kinds with a fixed livery.
 * @param cars - The loaded Kit models, or null to build procedurally.
 * @returns The model with its wheels, its lamps and, where the kind has them, light bar and turret.
 */
export function buildVehicleModel(
  kind: VehicleKind,
  colour: number,
  cars: CarAssets | null = null,
): VehicleModel {
  if (cars && isCarKind(kind))
    return buildGltfVehicleModel(cars.cars[kind], colour);
  const parts = createPartSet();
  const glowing: Lamp[] = [];
  const rig = SHAPES[kind](createKit(kind, colour, parts, glowing));
  const root = new Group();
  root.name = `vehicle-${kind}`;
  const body = parts.toMesh("body");
  root.add(body);
  const lamps = rigLamps(body, glowing);
  if (lamps.flares) root.add(lamps.flares);
  const wheels = rig.axles.flatMap((axle) => mountAxle(root, axle));
  const lightBar = rig.lightBar ? mountLightBar(root, rig.lightBar) : null;
  if (rig.turret) root.add(rig.turret);
  return { root, wheels, lightBar, turret: rig.turret ?? null, lamps };
}
