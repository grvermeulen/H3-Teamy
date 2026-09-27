/**
 * Where the driver sits in every vehicle kind, and what they see of the cockpit around them
 * (spec §4): eye position, steering wheel, dashboard, windscreen, pillars and bonnet. The numbers
 * are read off the exterior models in `vehicleShapes.ts` / `vehicleShapesHeavy.ts` (belt lines,
 * windscreen feet and rakes, roof heights), so the cockpit lines up with the car everyone else
 * sees.
 *
 * Car space, as for the vehicle models: +X forward, +Y up, +Z right, metres, origin at the
 * footprint centre on the ground. "Left" here is positive toward −Z: Dutch cars put the wheel on
 * the left.
 */
import type { VehicleKind } from "../sim/types";

/** How a kind's cockpit is framed. */
export type CockpitFrame =
  /** Pillars, roof header, door sills and a windscreen. */
  | "car"
  /** A tractor's open cab: corner posts and fenders, no roof or doors. */
  | "open"
  /** A tank's driver hatch: a coaming ring with two vision blocks, grips instead of a wheel. */
  | "hatch";

/** The steering wheel: its size and where it sits relative to the eye. */
export type CockpitWheel = {
  radiusM: number;
  /** Distance of the wheel's centre ahead of the eye. */
  aheadM: number;
  /** Drop of the wheel's centre below the eye. */
  dropM: number;
  /** Tilt of the wheel's face back from upright, radians: a bus's lies almost flat. */
  tiltRad: number;
};

/** The windscreen and the pillars that frame it. */
export type CockpitGlass = {
  /** Height of the windscreen's foot above the ground: the belt line. */
  baseM: number;
  /** Height of the roof header above the windscreen. */
  headerM: number;
  /** Half the windscreen's width at its foot: where the A-pillars stand. */
  pillarHalfM: number;
  /** Distance of the windscreen's foot ahead of the eye. */
  aheadM: number;
  /** How far back the header sits from the foot; 0 for an upright bus screen. */
  rakeM: number;
};

/** One kind's cockpit. */
export type CockpitSpec = {
  /** Eye above the ground, metres. */
  eyeHeightM: number;
  /** Eye ahead (+) / behind (−) the footprint centre along the car, metres. */
  eyeForwardM: number;
  /** Eye left of the centre line (Dutch cars: wheel on the left), metres (positive = left). */
  eyeLeftM: number;
  /** The steering wheel, or `null` for the tank's grips. */
  wheel: CockpitWheel | null;
  /** Dashboard top height above the ground, and its near edge's distance ahead of the eye. */
  dash: { heightM: number; aheadM: number };
  /**
   * The bonnet in the body colour, from the windscreen's foot toward the nose: length (0 for a
   * flat-fronted bus), width, and the height of its top at the windscreen.
   */
  bonnet: { lengthM: number; widthM: number; heightM: number };
  glass: CockpitGlass;
  frame: CockpitFrame;
};

/** The saloon's cockpit; the police car shares it under its light bar. */
const SEDAN_COCKPIT: CockpitSpec = {
  eyeHeightM: 1.16,
  eyeForwardM: -0.2,
  eyeLeftM: 0.38,
  wheel: { radiusM: 0.19, aheadM: 0.46, dropM: 0.3, tiltRad: 0.42 },
  dash: { heightM: 0.9, aheadM: 0.62 },
  bonnet: { lengthM: 1.08, widthM: 1.5, heightM: 0.84 },
  glass: {
    baseM: 0.84,
    headerM: 1.38,
    pillarHalfM: 0.69,
    aheadM: 1.15,
    rakeM: 0.55,
  },
  frame: "car",
};

/**
 * Every kind's cockpit, in car space. Bus: a high seat behind a big, nearly flat wheel and an
 * upright screen with nothing ahead of it. Tractor: a central seat in an open frame over a long
 * narrow bonnet. Tank: head out of the driver's hatch at the hull's front left, the glacis ahead.
 */
export const COCKPITS: Readonly<Record<VehicleKind, CockpitSpec>> = {
  compact: {
    ...SEDAN_COCKPIT,
    eyeHeightM: 1.2,
    eyeForwardM: -0.15,
    dash: { heightM: 0.92, aheadM: 0.62 },
    bonnet: { lengthM: 1.02, widthM: 1.5, heightM: 0.86 },
    glass: { ...SEDAN_COCKPIT.glass, baseM: 0.86, headerM: 1.45, rakeM: 0.6 },
  },
  sedan: SEDAN_COCKPIT,
  sport: {
    ...SEDAN_COCKPIT,
    eyeHeightM: 0.98,
    eyeForwardM: -0.45,
    wheel: { radiusM: 0.18, aheadM: 0.46, dropM: 0.27, tiltRad: 0.5 },
    dash: { heightM: 0.75, aheadM: 0.62 },
    bonnet: { lengthM: 1.33, widthM: 1.5, heightM: 0.7 },
    glass: {
      ...SEDAN_COCKPIT.glass,
      baseM: 0.7,
      headerM: 1.11,
      pillarHalfM: 0.67,
      rakeM: 0.62,
    },
  },
  police: SEDAN_COCKPIT,
  van: {
    eyeHeightM: 1.78,
    eyeForwardM: 0.9,
    eyeLeftM: 0.46,
    wheel: { radiusM: 0.2, aheadM: 0.45, dropM: 0.42, tiltRad: 0.62 },
    dash: { heightM: 1.26, aheadM: 0.62 },
    bonnet: { lengthM: 0.48, widthM: 1.7, heightM: 1.15 },
    glass: {
      baseM: 1.15,
      headerM: 2.12,
      pillarHalfM: 0.88,
      aheadM: 1.05,
      rakeM: 0.45,
    },
    frame: "car",
  },
  pickup: {
    eyeHeightM: 1.52,
    eyeForwardM: 0.3,
    eyeLeftM: 0.4,
    wheel: { radiusM: 0.2, aheadM: 0.46, dropM: 0.36, tiltRad: 0.5 },
    dash: { heightM: 1.06, aheadM: 0.62 },
    bonnet: { lengthM: 1.33, widthM: 1.6, heightM: 1.02 },
    glass: {
      baseM: 1.02,
      headerM: 1.78,
      pillarHalfM: 0.72,
      aheadM: 0.9,
      rakeM: 0.45,
    },
    frame: "car",
  },
  bus: {
    eyeHeightM: 2.3,
    eyeForwardM: 4.95,
    eyeLeftM: 0.72,
    wheel: { radiusM: 0.26, aheadM: 0.5, dropM: 0.52, tiltRad: 1.05 },
    dash: { heightM: 1.62, aheadM: 0.7 },
    bonnet: { lengthM: 0, widthM: 2.3, heightM: 0.95 },
    glass: {
      baseM: 0.95,
      headerM: 2.6,
      pillarHalfM: 1.12,
      aheadM: 0.99,
      rakeM: 0,
    },
    frame: "car",
  },
  oldtimer: {
    eyeHeightM: 1.32,
    eyeForwardM: -0.62,
    eyeLeftM: 0.3,
    wheel: { radiusM: 0.21, aheadM: 0.48, dropM: 0.32, tiltRad: 0.36 },
    dash: { heightM: 1.02, aheadM: 0.66 },
    bonnet: { lengthM: 1.75, widthM: 0.95, heightM: 0.97 },
    glass: {
      baseM: 0.97,
      headerM: 1.53,
      pillarHalfM: 0.47,
      aheadM: 0.97,
      rakeM: 0.18,
    },
    frame: "car",
  },
  tractor: {
    eyeHeightM: 2.08,
    eyeForwardM: -0.58,
    eyeLeftM: 0,
    wheel: { radiusM: 0.2, aheadM: 0.46, dropM: 0.5, tiltRad: 0.85 },
    dash: { heightM: 1.5, aheadM: 0.55 },
    bonnet: { lengthM: 1.68, widthM: 0.8, heightM: 1.42 },
    glass: {
      baseM: 1.28,
      headerM: 2.44,
      pillarHalfM: 0.65,
      aheadM: 0.7,
      rakeM: 0.08,
    },
    frame: "open",
  },
  tank: {
    eyeHeightM: 1.72,
    eyeForwardM: 0.95,
    eyeLeftM: 0.45,
    wheel: null,
    dash: { heightM: 1.4, aheadM: 0.34 },
    bonnet: { lengthM: 0.95, widthM: 1.74, heightM: 1.38 },
    glass: {
      baseM: 1.38,
      headerM: 1.62,
      pillarHalfM: 0.3,
      aheadM: 0.4,
      rakeM: 0,
    },
    frame: "hatch",
  },
};

/** The driver's eye in car space: along the car, to its left and above the ground, metres. */
export type SeatOffset = Readonly<{
  forwardM: number;
  leftM: number;
  heightM: number;
}>;

/** One frozen seat per kind, made on first use, so the camera rig reads it without allocating. */
const seats = new Map<VehicleKind, SeatOffset>();

/**
 * Where the driver's eye sits in a kind of vehicle.
 *
 * @param kind - The vehicle kind.
 * @returns The eye's offset from the footprint centre; the same frozen object on every call.
 */
export function seatOffset(kind: VehicleKind): SeatOffset {
  const cached = seats.get(kind);
  if (cached) return cached;
  const spec = COCKPITS[kind];
  const seat = Object.freeze({
    forwardM: spec.eyeForwardM,
    leftM: spec.eyeLeftM,
    heightM: spec.eyeHeightM,
  });
  seats.set(kind, seat);
  return seat;
}
