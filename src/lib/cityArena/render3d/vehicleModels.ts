/**
 * Procedural low-poly models of every vehicle kind (spec §6.7), read as the 3D versions of the 2D
 * sprites: the same body colours, the olive tank, the green tractor with yellow rims, the white
 * police car in Dutch blue-and-orange livery, the white-and-blue city bus.
 *
 * A model is one merged body mesh (a draw group per material), four wheel meshes that spin and
 * steer, and — for the police car and the tank — a light bar or a turret. Its frame: local forward
 * +X, origin at the footprint centre on the ground, exactly `lengthOf × widthOf` of the simulation.
 */
import { Group, Mesh, Object3D, type MeshLambertMaterial } from "three";
import type { VehicleKind } from "../sim/types";
import { lengthOf, widthOf } from "../sim/vehicle";
import {
  CAR_BODY_COLOURS,
  POLICE_LIGHT_BLUE,
  POLICE_LIGHT_RED,
} from "../render/palette";
import {
  createPartSet,
  detailMaterial,
  glowMaterial,
  matteMaterial,
  paintMaterial,
  slab,
  wheelGeometry,
  type PartSet,
} from "./vehicleParts";
import {
  addParts,
  LIGHT_BAR_HEIGHT_M,
  PASSENGER_SHAPES,
  SIDES,
  type Axle,
  type Kit,
  type Shape,
  type ShapeRig,
} from "./vehicleShapes";
import { HEAVY_SHAPES } from "./vehicleShapesHeavy";

/** Roof height of the sedan, which the police car shares under its light bar. */
const SEDAN_ROOF_M = 1.45;

/** Overall height of each kind, ground to its highest part (roof, light bar, roof units, hatch). */
export const VEHICLE_HEIGHT_M: Readonly<Record<VehicleKind, number>> = {
  compact: 1.52,
  sedan: SEDAN_ROOF_M,
  sport: 1.18,
  police: SEDAN_ROOF_M + LIGHT_BAR_HEIGHT_M,
  van: 2.25,
  pickup: 1.85,
  bus: 3.1,
  oldtimer: 1.6,
  tractor: 2.6,
  tank: 2.25,
};

/**
 * How tall a kind's model stands, metres.
 *
 * @param kind - The vehicle kind.
 * @returns Ground to the highest part.
 */
export function vehicleHeight(kind: VehicleKind): number {
  return VEHICLE_HEIGHT_M[kind];
}

/** Kinds that keep their own livery whatever their colour index, as their 2D sprites do. */
const FIXED_BODY_COLOUR: Partial<Record<VehicleKind, number>> = {
  police: 0xf2f2ee,
  bus: 0xe8e8e4,
  tractor: 0x3f7040,
  tank: 0x4a5a33,
};

/** A `#rrggbb` palette colour as a number. */
function hexOf(css: string): number {
  return Number.parseInt(css.slice(1), 16);
}

/**
 * The body colour of a vehicle: its kind's livery, or the palette colour its index picks.
 *
 * @param kind - The vehicle kind.
 * @param colour - `VehicleState.colour`, an index into `CAR_BODY_COLOURS`.
 * @returns The colour, `0xrrggbb`.
 */
export function bodyColour(kind: VehicleKind, colour: number): number {
  return (
    FIXED_BODY_COLOUR[kind] ??
    hexOf(CAR_BODY_COLOURS[colour % CAR_BODY_COLOURS.length])
  );
}

/** Lens colours of the light bar: blue on the left, red on the right, and their unlit tint. */
const LENS_COLOURS = {
  left: { lit: hexOf(POLICE_LIGHT_BLUE), dark: 0x1c2a4d },
  right: { lit: hexOf(POLICE_LIGHT_RED), dark: 0x4a1c1c },
} as const;

/**
 * The material of one light-bar lens.
 *
 * @param side - `left` is the blue lens, `right` the red one.
 * @param lit - Whether it is flashing on.
 * @returns A shared material: emissive when lit, dull otherwise.
 */
export function lensMaterial(
  side: keyof typeof LENS_COLOURS,
  lit: boolean,
): MeshLambertMaterial {
  const colours = LENS_COLOURS[side];
  return lit ? glowMaterial(colours.lit) : matteMaterial(colours.dark);
}

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

/** A kit adding to `parts`, painted in the vehicle's body colour. */
function createKit(kind: VehicleKind, colour: number, parts: PartSet): Kit {
  const paint = paintMaterial(bodyColour(kind, colour));
  const detail = detailMaterial();
  return {
    length: lengthOf(kind),
    width: widthOf(kind),
    height: vehicleHeight(kind),
    paint: (geometry) => parts.add(paint, geometry),
    tint: (geometry, hex) => parts.add(detail, geometry, hex),
    glow: (geometry, hex) => parts.add(glowMaterial(hex), geometry),
    assemble: (name, list) => {
      const own = createPartSet();
      addParts(createKit(kind, colour, own), list);
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
 * Builds a vehicle of one kind and colour.
 *
 * @param kind - The vehicle kind.
 * @param colour - `VehicleState.colour`; ignored by kinds with a fixed livery.
 * @returns The model with its wheels and, where the kind has them, light bar and turret.
 */
export function buildVehicleModel(
  kind: VehicleKind,
  colour: number,
): VehicleModel {
  const parts = createPartSet();
  const rig = SHAPES[kind](createKit(kind, colour, parts));
  const root = new Group();
  root.name = `vehicle-${kind}`;
  root.add(parts.toMesh("body"));
  const wheels = rig.axles.flatMap((axle) => mountAxle(root, axle));
  const lightBar = rig.lightBar ? mountLightBar(root, rig.lightBar) : null;
  if (rig.turret) root.add(rig.turret);
  return { root, wheels, lightBar, turret: rig.turret ?? null };
}
