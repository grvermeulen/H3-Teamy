/**
 * The shapes of the passenger-type vehicles — compact, sedan, sport, police, van, pickup and
 * oldtimer — and the kit every shape builds with. A shape adds its static parts to a {@link Kit}
 * and hands back what moves: its axles, and where a light bar or turret goes.
 *
 * Frame: x forward, y up, z to the right, metres, origin at the footprint centre on the ground.
 * Every part stays inside the simulation's `lengthOf × widthOf` box, so the model covers exactly
 * the hull the physics collides with. Part tables hold each kind's measurements, named by row.
 */
import type { BufferGeometry, Mesh, Object3D } from "three";
import {
  addDoorLines,
  addPlates,
  addWheelArches,
  PLATE_LOOKS,
} from "./vehicleTrim";
import {
  cylinder,
  slab,
  type CylinderSpec,
  type Point3,
  type SlabSpec,
  type Span,
  type Taper,
  type WheelLook,
} from "./vehicleParts";

/** One static part: a slab or a cylinder, in the body colour or a fixed one. */
export type Part = {
  /** `"paint"` for the body colour, else a fixed `0xrrggbb`. */
  colour: "paint" | number;
  /** A lamp: glows in its colour. */
  glow?: boolean;
  /** Also adds the mirror image across the centre line. */
  mirror?: boolean;
  shape: SlabSpec | CylinderSpec;
};

/** Where a vehicle's static parts go, with its footprint and height. */
export type Kit = {
  length: number;
  width: number;
  height: number;
  /** Adds a part in the body colour. */
  paint(geometry: BufferGeometry): void;
  /** Adds a part in a fixed colour: glass, trim, stripes. */
  tint(geometry: BufferGeometry, hex: number): void;
  /** Adds a lamp that glows in `hex`. */
  glow(geometry: BufferGeometry, hex: number): void;
  /** Builds `parts` into a separate mesh with the same materials: a part that moves. */
  assemble(name: string, parts: readonly Part[]): Mesh;
};

/** A pair of wheels: where the axle sits, how far out the wheels stand, and whether they steer. */
export type Axle = {
  x: number;
  track: number;
  wheel: WheelLook;
  steers: boolean;
};

/** What a shape hands back besides its static parts. */
export type ShapeRig = {
  axles: readonly Axle[];
  /** Where the light bar's lenses stand: centred on `x` along the body, from `y[0]` up to `y[1]`. */
  lightBar?: { x: number; y: Span };
  /** The turret, pivoting about its own origin, already placed on the hull. */
  turret?: Object3D;
};

/** Builds one kind into a kit. */
export type Shape = (kit: Kit) => ShapeRig;

/** Car window glass: tinted darker than the 2D sprite's, the gloss still catching the light. */
export const GLASS = 0x121a24;
/** Bumpers, grilles, bed liners and other black plastic. */
export const TRIM = 0x26282c;
/** Polished bumpers, grilles and hubs. */
export const CHROME = 0xc3c8cf;
/** Rubber. */
export const TYRE = 0x1b1b1d;
/** Plain steel rims. */
export const STEEL_RIM = 0xaeb3ba;
/** The dark cross on a rim that shows it turning. */
export const DARK_HUB = 0x2b2e33;
/** Headlight lenses (spec §6.7). */
export const HEADLIGHT = 0xfff3c4;
/** Tail light lenses (spec §6.7). */
export const TAIL_LIGHT = 0xff2a2a;
/** The two sides of a vehicle: left (−z), then right (+z). */
export const SIDES = [-1, 1] as const;

/**
 * Adds a slab and its mirror image across the centre line.
 *
 * @param spec - The right-hand slab; its `z` is mirrored to the left.
 * @param add - Receives each copy.
 */
export function mirrored(
  spec: SlabSpec,
  add: (geometry: BufferGeometry) => void,
): void {
  for (const side of SIDES) add(slab({ ...spec, z: side * (spec.z ?? 0) }));
}

/** The geometry of one side of a part. */
function geometryOf(
  shape: SlabSpec | CylinderSpec,
  side: number,
): BufferGeometry {
  if ("radius" in shape) {
    const [x, y, z] = shape.at;
    return cylinder({ ...shape, at: [x, y, side * z] });
  }
  return slab({ ...shape, z: side * (shape.z ?? 0) });
}

/**
 * Adds a table of parts to a kit, mirroring the rows that ask for it.
 *
 * @param kit - The vehicle.
 * @param parts - The rows.
 */
export function addParts(kit: Kit, parts: readonly Part[]): void {
  for (const part of parts)
    for (const side of part.mirror ? SIDES : [1]) {
      const geometry = geometryOf(part.shape, side);
      if (part.colour === "paint") kit.paint(geometry);
      else if (part.glow) kit.glow(geometry, part.colour);
      else kit.tint(geometry, part.colour);
    }
}

/**
 * An axle whose wheels sit flush with the footprint's sides unless `track` says otherwise.
 *
 * @param kit - The vehicle.
 * @param x - Axle position along the body.
 * @param wheel - The wheel look.
 * @param steers - Whether the pair turns with the steering.
 * @param track - Distance of each wheel's centre from the centre line.
 * @returns The axle.
 */
export function axle(
  kit: Kit,
  x: number,
  wheel: WheelLook,
  steers: boolean,
  track = kit.width / 2 - wheel.width / 2,
): Axle {
  return { x, track, wheel, steers };
}

/** Bumper depth along the body. */
const BUMPER_DEPTH_M = 0.12;
/** Bumper height. */
const BUMPER_HEIGHT_M = 0.18;
/** Bumpers stop this far short of the footprint's sides. */
const BUMPER_INSET_M = 0.06;

/**
 * Black bumpers at both ends of the footprint.
 *
 * @param kit - The vehicle.
 * @param bottom - Height of the bumpers' lower edge.
 */
export function addBumpers(kit: Kit, bottom: number): void {
  const end = kit.length / 2;
  const ends: Span[] = [
    [end - BUMPER_DEPTH_M, end],
    [-end, -end + BUMPER_DEPTH_M],
  ];
  for (const x of ends)
    kit.tint(
      slab({
        x,
        y: [bottom, bottom + BUMPER_HEIGHT_M],
        width: kit.width - 2 * BUMPER_INSET_M,
      }),
      TRIM,
    );
}

/**
 * Silhouette of a passenger car. The lower body runs from `sill` to `belt`; the glass house sits
 * on the belt from `cabin[0]` to `cabin[1]`, its top pulled in by `taper` (windscreen, rear window,
 * tumblehome). `bodyInset` keeps the body inside the wheels, so they stand proud of its sides.
 */
type CarProfile = {
  sill: number;
  belt: number;
  cabin: Span;
  taper: Required<Taper>;
  bodyInset: number;
  wheel: WheelLook;
  axleInset: number;
};

/** Body ends stop this far short of the bumpers' faces. */
const BODY_END_M = 0.05;
/** How far the nose slopes back from its foot to the bonnet's edge. */
const NOSE_SLOPE_M = 0.1;
/** How far the tail slopes forward to the boot lid. */
const TAIL_SLOPE_M = 0.06;
/** How far the body's sides lean in from sill to belt. */
const SHOULDER_M = 0.04;
/** The glass house sits this far inside the body's sides at the belt. */
const GLASS_STEP_M = 0.09;
/** Thickness of a roof panel. */
const ROOF_THICKNESS_M = 0.07;
/** Width of the pillar between the side windows. */
const PILLAR_M = 0.12;
/** How much wider than the surface under it a pillar or roof panel is, both sides together. */
const PROUD_M = 0.02;
/** Lamps reach this far into the body from its end. */
const LAMP_DEPTH_M = 0.12;
/** Lamp and grille faces sit this far behind the bumper's face. */
const LAMP_SET_BACK_M = 0.03;
/** Lamp lens width across the body. */
const LAMP_WIDTH_M = 0.34;
/** Lamp height. */
const LAMP_HEIGHT_M = 0.12;
/** Lamp tops sit this far under the belt line. */
const LAMP_DROP_M = 0.08;
/** Lamp centres sit this far in from the footprint's sides. */
const LAMP_EDGE_M = 0.3;
/** The grille's share of the body width. */
const GRILLE_SHARE = 0.34;
/** Door mirror size in every direction. */
const MIRROR_M = 0.12;
/** Bevels on a car's lower body, its glass house and its roof panel. */
const BODY_BEVEL_M = 0.05;
const GLASS_BEVEL_M = 0.025;
const ROOF_BEVEL_M = 0.02;
/** Door lines sit this far inside the pillars' feet. */
const DOOR_LINE_INSET_M = 0.06;
/** The rear plate's middle stands this far above the bumper's top. */
const REAR_PLATE_RISE_M = 0.09;
/** The mirrors sit this far behind the windscreen's foot. */
const MIRROR_SET_BACK_M = 0.16;

/** The wheel of the four original kinds. */
const CAR_WHEEL: WheelLook = {
  radius: 0.33,
  width: 0.22,
  tyre: TYRE,
  rim: STEEL_RIM,
  hub: DARK_HUB,
};

/** A three-box saloon — bonnet, cabin, boot. The police car shares it. */
const SEDAN: CarProfile = {
  sill: 0.3,
  belt: 0.82,
  cabin: [-1.15, 0.95],
  taper: { front: 0.55, rear: 0.45, side: 0.1 },
  bodyInset: 0.07,
  wheel: CAR_WHEEL,
  axleInset: 0.8,
};

/** A hatchback: the cabin runs back to a near-upright tail. */
const COMPACT: CarProfile = {
  sill: 0.3,
  belt: 0.84,
  cabin: [-1.95, 1.0],
  taper: { front: 0.6, rear: 0.12, side: 0.1 },
  bodyInset: 0.07,
  wheel: CAR_WHEEL,
  axleInset: 0.7,
};

/** Low and long-bonneted, with a raked screen and wide tyres on dark rims with bright hubs. */
const SPORT: CarProfile = {
  sill: 0.22,
  belt: 0.68,
  cabin: [-1.3, 0.7],
  taper: { front: 0.62, rear: 0.5, side: 0.12 },
  bodyInset: 0.07,
  wheel: { radius: 0.34, width: 0.26, tyre: TYRE, rim: 0x3a3d42, hub: CHROME },
  axleInset: 0.78,
};

/** The pickup's cab and bonnet; the bed stands on the lower body behind the cab. */
const PICKUP: CarProfile = {
  sill: 0.45,
  belt: 1.0,
  cabin: [-0.3, 1.2],
  taper: { front: 0.45, rear: 0.06, side: 0.08 },
  bodyInset: 0.07,
  wheel: {
    radius: 0.4,
    width: 0.26,
    tyre: TYRE,
    rim: STEEL_RIM,
    hub: DARK_HUB,
  },
  axleInset: 0.95,
};

/** A narrow body between separate fenders, an upright cabin and whitewall tyres. */
const OLDTIMER: CarProfile = {
  sill: 0.42,
  belt: 0.95,
  cabin: [-1.55, 0.35],
  taper: { front: 0.18, rear: 0.28, side: 0.06 },
  bodyInset: 0.25,
  wheel: { radius: 0.36, width: 0.16, tyre: TYRE, rim: 0xece6d6, hub: CHROME },
  axleInset: 0.85,
};

/** Front and rear axle `inset` from each end, the front one steering. */
function axlesInset(kit: Kit, wheel: WheelLook, inset: number): Axle[] {
  const x = kit.length / 2 - inset;
  return [axle(kit, x, wheel, true), axle(kit, -x, wheel, false)];
}

/** The lower body: a bevelled slab sloping at nose and tail and leaning in at the shoulders. */
function addCarBody(kit: Kit, profile: CarProfile): void {
  const end = kit.length / 2 - BODY_END_M;
  kit.paint(
    slab({
      x: [-end, end],
      y: [profile.sill, profile.belt],
      width: kit.width - 2 * profile.bodyInset,
      taper: { front: NOSE_SLOPE_M, rear: TAIL_SLOPE_M, side: SHOULDER_M },
      bevel: BODY_BEVEL_M,
    }),
  );
}

/** The glass house, its roof panel in the body colour, and a pillar between the side windows. */
function addGreenhouse(kit: Kit, profile: CarProfile, roof: number): void {
  const { taper, belt } = profile;
  const glassWidth =
    kit.width - 2 * (profile.bodyInset + SHOULDER_M + GLASS_STEP_M);
  const top = roof - ROOF_THICKNESS_M;
  kit.tint(
    slab({
      x: profile.cabin,
      y: [belt, top],
      width: glassWidth,
      taper,
      bevel: GLASS_BEVEL_M,
    }),
    GLASS,
  );
  const roofSpan: Span = [
    profile.cabin[0] + taper.rear,
    profile.cabin[1] - taper.front,
  ];
  const roofWidth = glassWidth - 2 * taper.side + PROUD_M;
  kit.paint(
    slab({
      x: roofSpan,
      y: [top, roof],
      width: roofWidth,
      bevel: ROOF_BEVEL_M,
    }),
  );
  const pillarX = (roofSpan[0] + roofSpan[1]) / 2;
  kit.paint(
    slab({
      x: [pillarX - PILLAR_M / 2, pillarX + PILLAR_M / 2],
      y: [belt, top],
      width: glassWidth + PROUD_M,
      taper: { side: taper.side },
    }),
  );
}

/** Bumpers, grille, headlights and tail lights of a passenger car. */
function addCarEnds(kit: Kit, profile: CarProfile): void {
  const end = kit.length / 2;
  const { sill, belt } = profile;
  addBumpers(kit, sill);
  kit.tint(
    slab({
      x: [end - LAMP_DEPTH_M, end - LAMP_SET_BACK_M],
      y: [sill + BUMPER_HEIGHT_M, belt - LAMP_DROP_M],
      width: kit.width * GRILLE_SHARE,
    }),
    TRIM,
  );
  const lamp = {
    y: [belt - LAMP_DROP_M - LAMP_HEIGHT_M, belt - LAMP_DROP_M] as const,
    width: LAMP_WIDTH_M,
    z: kit.width / 2 - LAMP_EDGE_M,
  };
  mirrored({ ...lamp, x: [end - LAMP_DEPTH_M, end - LAMP_SET_BACK_M] }, (g) =>
    kit.glow(g, HEADLIGHT),
  );
  mirrored({ ...lamp, x: [-end + LAMP_SET_BACK_M, -end + LAMP_DEPTH_M] }, (g) =>
    kit.glow(g, TAIL_LIGHT),
  );
}

/** Door mirrors just behind the windscreen's foot, reaching the footprint's sides. */
function addMirrors(kit: Kit, profile: CarProfile): void {
  const x = profile.cabin[1] - MIRROR_SET_BACK_M;
  mirrored(
    {
      x: [x - MIRROR_M, x],
      y: [profile.belt, profile.belt + MIRROR_M],
      width: MIRROR_M,
      z: kit.width / 2 - MIRROR_M / 2,
    },
    kit.paint,
  );
}

/** Where a car's doors meet: the A-pillar's foot, the B-pillar and the C-pillar's foot. */
function doorStations(profile: CarProfile): number[] {
  const { cabin, taper } = profile;
  const front = cabin[1] - taper.front + DOOR_LINE_INSET_M;
  const rear = cabin[0] + taper.rear - DOOR_LINE_INSET_M;
  return [front, (front + rear) / 2, rear];
}

/** A car's wheel arches, door lines and plates. */
function addCarTrim(
  kit: Kit,
  profile: CarProfile,
  axles: readonly Axle[],
): void {
  const side = kit.width / 2 - profile.bodyInset;
  addWheelArches(kit, axles, side);
  addDoorLines(kit, doorStations(profile), {
    sill: profile.sill,
    belt: profile.belt,
    side,
    lean: SHOULDER_M,
  });
  addPlates(kit, {
    front: profile.sill + BUMPER_HEIGHT_M / 2,
    rear: profile.sill + BUMPER_HEIGHT_M + REAR_PLATE_RISE_M,
  });
}

/** A whole passenger car with its roof at `roof`; returns its axles. */
function passengerCar(kit: Kit, profile: CarProfile, roof: number): Axle[] {
  addCarBody(kit, profile);
  addGreenhouse(kit, profile, roof);
  addCarEnds(kit, profile);
  addMirrors(kit, profile);
  const axles = axlesInset(kit, profile.wheel, profile.axleInset);
  addCarTrim(kit, profile, axles);
  return axles;
}

/** Height of the police light bar from the roof to the top of its lenses. */
export const LIGHT_BAR_HEIGHT_M = 0.17;
/** Height of the bar's black base under the lenses. */
const LIGHT_BAR_BASE_M = 0.05;
/** Size of that base along the body. */
const LIGHT_BAR_BASE_LENGTH_M = 0.38;
/** Size of that base across the body. */
const LIGHT_BAR_BASE_WIDTH_M = 1.2;
/** The blue of the Dutch police livery. */
const POLICE_BLUE = 0x1f4fa8;
/** The fluorescent orange of the Dutch police livery. */
const POLICE_ORANGE = 0xf06418;
/** Width of one leaning stripe along the side. */
const SIDE_STRIPE_PITCH_M = 0.24;
/** Width of one diagonal stripe on the bonnet. */
const BONNET_STRIPE_PITCH_M = 0.16;
/** How far a side stripe leans forward per metre of height. */
const SIDE_STRIPE_LEAN = 0.8;
/** How far a bonnet stripe runs forward per metre across the car. */
const BONNET_STRIPE_LEAN = 0.25;
/** Thickness of a livery panel: half sinks into the body so the leaning sides never gap. */
const LIVERY_DEPTH_M = 0.05;
/** How far the livery's outer face stands out of the body at the sill. */
const LIVERY_PROUD_M = 0.005;
/** Thickness of the bonnet stripes on top of the body. */
const BONNET_STRIPE_THICKNESS_M = 0.012;
/** The blue sill band, as heights above the sill. */
const SILL_BAND: Span = [0.03, 0.15];
/** The band of leaning stripes, as heights above the sill. */
const STRIPE_BAND: Span = [0.2, 0.46];
/** The side livery stops this far from the car's ends. */
const STRIPE_END_MARGIN_M = 0.35;

/** Alternating orange and blue, starting with orange. */
function stripeColour(index: number): number {
  return index % 2 === 0 ? POLICE_ORANGE : POLICE_BLUE;
}

/** Height of the police livery's band of leaning stripes. */
export const POLICE_STRIPE_HEIGHT_M = STRIPE_BAND[1] - STRIPE_BAND[0];

/** Where a band of livery stripes runs: along the body, up the flank, and the flank's distance out. */
export type StripeBand = { x: Span; y: Span; side: number };

/**
 * A band of leaning orange and blue stripes on both flanks, half sunk into a flank `band.side`
 * from the centre line so it never floats off it.
 *
 * @param kit - Where its parts go.
 * @param band - Where it runs.
 */
export function addPoliceStripes(
  kit: Pick<Kit, "tint">,
  band: StripeBand,
): void {
  const z = band.side - LIVERY_DEPTH_M / 2 + LIVERY_PROUD_M;
  const panel = { y: band.y, width: LIVERY_DEPTH_M, z };
  const count = Math.floor((band.x[1] - band.x[0]) / SIDE_STRIPE_PITCH_M);
  const shear = { axis: "y", perMetre: SIDE_STRIPE_LEAN } as const;
  for (let index = 0; index < count; index++) {
    const from = band.x[0] + index * SIDE_STRIPE_PITCH_M;
    mirrored({ ...panel, x: [from, from + SIDE_STRIPE_PITCH_M], shear }, (g) =>
      kit.tint(g, stripeColour(index)),
    );
  }
}

/** A blue sill band and a band of leaning orange and blue stripes along both sides. */
function addPoliceSides(kit: Kit, profile: CarProfile): void {
  const side = kit.width / 2 - profile.bodyInset;
  const z = side - LIVERY_DEPTH_M / 2 + LIVERY_PROUD_M;
  const reach = kit.length / 2 - STRIPE_END_MARGIN_M;
  const band = (span: Span): Span => [
    profile.sill + span[0],
    profile.sill + span[1],
  ];
  mirrored(
    { x: [-reach, reach], y: band(SILL_BAND), width: LIVERY_DEPTH_M, z },
    (g) => kit.tint(g, POLICE_BLUE),
  );
  addPoliceStripes(kit, { x: [-reach, reach], y: band(STRIPE_BAND), side });
}

/** Diagonal orange and blue stripes across the bonnet, as on the 2D sprite. */
function addPoliceBonnet(kit: Kit, profile: CarProfile): void {
  const width = kit.width - 2 * (profile.bodyInset + SHOULDER_M) - PROUD_M;
  const lean = (BONNET_STRIPE_LEAN * width) / 2 + BONNET_STRIPE_PITCH_M / 2;
  const from = profile.cabin[1] + lean;
  const to = kit.length / 2 - BODY_END_M - NOSE_SLOPE_M - lean;
  const count = Math.floor((to - from) / BONNET_STRIPE_PITCH_M) + 1;
  const half = BONNET_STRIPE_PITCH_M / 2;
  for (let index = 0; index < count; index++) {
    const x = from + index * BONNET_STRIPE_PITCH_M;
    kit.tint(
      slab({
        x: [x - half, x + half],
        y: [profile.belt, profile.belt + BONNET_STRIPE_THICKNESS_M],
        width,
        shear: { axis: "z", perMetre: BONNET_STRIPE_LEAN },
      }),
      stripeColour(index),
    );
  }
}

/** A sedan in Dutch police livery with a light bar across the middle of the roof. */
const policeShape: Shape = (kit) => {
  const roof = kit.height - LIGHT_BAR_HEIGHT_M;
  const axles = passengerCar(kit, SEDAN, roof);
  addPoliceSides(kit, SEDAN);
  addPoliceBonnet(kit, SEDAN);
  const { cabin, taper } = SEDAN;
  const x = (cabin[0] + taper.rear + cabin[1] - taper.front) / 2;
  const half = LIGHT_BAR_BASE_LENGTH_M / 2;
  kit.tint(
    slab({
      x: [x - half, x + half],
      y: [roof, roof + LIGHT_BAR_BASE_M],
      width: LIGHT_BAR_BASE_WIDTH_M,
    }),
    TRIM,
  );
  return {
    axles,
    lightBar: { x, y: [roof + LIGHT_BAR_BASE_M, roof + LIGHT_BAR_HEIGHT_M] },
  };
};

/** The sports car's rear wing on two posts, and intakes behind the doors. */
const SPORT_EXTRAS: readonly Part[] = [
  // The wing, then its posts, then the intakes.
  { colour: TRIM, shape: { x: [-2.06, -1.8], y: [0.88, 0.93], width: 1.5 } },
  {
    colour: TRIM,
    mirror: true,
    shape: { x: [-1.98, -1.9], y: [0.68, 0.88], width: 0.05, z: 0.5 },
  },
  {
    colour: TRIM,
    mirror: true,
    shape: { x: [-1.05, -0.6], y: [0.3, 0.52], width: 0.05, z: 0.815 },
  },
];

/** The van's tall load box, short bonnet, raked windscreen and trim (5 × 2 m, 2.25 m tall). */
const VAN_PARTS: readonly Part[] = [
  // Load box, bonnet and windscreen.
  {
    colour: "paint",
    shape: {
      x: [-2.45, 1.5],
      y: [0.35, 2.25],
      width: 1.86,
      taper: { side: 0.04, front: 0.05, rear: 0.03 },
    },
  },
  {
    colour: "paint",
    shape: {
      x: [1.45, 2.45],
      y: [0.35, 1.15],
      width: 1.86,
      taper: { front: 0.22, side: 0.04 },
    },
  },
  {
    colour: GLASS,
    shape: {
      x: [1.42, 1.95],
      y: [1.15, 2.13],
      width: 1.8,
      taper: { front: 0.45, side: 0.04 },
    },
  },
  // Cab side windows and the rubbing strips along the load box.
  {
    colour: GLASS,
    mirror: true,
    shape: { x: [0.6, 1.42], y: [1.3, 2.0], width: 0.05, z: 0.91 },
  },
  {
    colour: TRIM,
    mirror: true,
    shape: { x: [-2.2, 1.3], y: [0.72, 0.8], width: 0.05, z: 0.91 },
  },
  // Rear door windows and the seam between the doors.
  { colour: GLASS, shape: { x: [-2.47, -2.42], y: [1.35, 2.0], width: 1.5 } },
  {
    colour: "paint",
    shape: { x: [-2.475, -2.415], y: [0.4, 2.05], width: 0.08 },
  },
  // Headlights, tall tail lights and black door mirrors.
  {
    colour: HEADLIGHT,
    glow: true,
    mirror: true,
    shape: { x: [2.2, 2.42], y: [0.85, 1.0], width: 0.3, z: 0.72 },
  },
  {
    colour: TAIL_LIGHT,
    glow: true,
    mirror: true,
    shape: { x: [-2.48, -2.4], y: [0.55, 1.25], width: 0.12, z: 0.86 },
  },
  {
    colour: TRIM,
    mirror: true,
    shape: { x: [1.36, 1.5], y: [1.25, 1.45], width: 0.1, z: 0.95 },
  },
];

/** Height of the lower edge of the van's bumpers. */
const VAN_BUMPER_Y_M = 0.35;
/** Distance of the van's axles from each end. */
const VAN_AXLE_INSET_M = 0.85;
/** The van's wheel. */
const VAN_WHEEL: WheelLook = {
  radius: 0.36,
  width: 0.24,
  tyre: TYRE,
  rim: STEEL_RIM,
  hub: DARK_HUB,
};

/** Half the width of the van's load box, metres: where its arches stand. */
const VAN_SIDE_M = 0.93;

/** A panel van. */
const vanShape: Shape = (kit) => {
  addParts(kit, VAN_PARTS);
  addBumpers(kit, VAN_BUMPER_Y_M);
  const axles = axlesInset(kit, VAN_WHEEL, VAN_AXLE_INSET_M);
  addWheelArches(kit, axles, VAN_SIDE_M);
  const plate = VAN_BUMPER_Y_M + BUMPER_HEIGHT_M / 2;
  addPlates(kit, { front: plate, rear: plate + BUMPER_HEIGHT_M });
  return { axles };
};

/** Thickness of the pickup bed's walls. */
const BED_WALL_M = 0.07;
/** Height of the bed's walls above the lower body. */
const BED_WALL_HEIGHT_M = 0.4;
/** The tailgate sits this much lower than the side walls. */
const TAILGATE_DROP_M = 0.04;
/** Thickness of the black liner on the bed floor. */
const BED_LINER_M = 0.015;

/** The pickup's open bed: side walls, a wall behind the cab, a tailgate and a black liner. */
function addPickupBed(kit: Kit, profile: CarProfile): void {
  const tail = -kit.length / 2 + BODY_END_M;
  const inner = kit.width - 2 * (profile.bodyInset + SHOULDER_M);
  const front = profile.cabin[0];
  const floor = profile.belt;
  const top = floor + BED_WALL_HEIGHT_M;
  const z = inner / 2 - BED_WALL_M / 2;
  mirrored(
    { x: [tail, front], y: [floor, top], width: BED_WALL_M, z },
    kit.paint,
  );
  kit.paint(
    slab({ x: [front - BED_WALL_M, front], y: [floor, top], width: inner }),
  );
  kit.paint(
    slab({
      x: [tail, tail + BED_WALL_M],
      y: [floor, top - TAILGATE_DROP_M],
      width: inner,
    }),
  );
  kit.tint(
    slab({
      x: [tail + BED_WALL_M, front - BED_WALL_M],
      y: [floor, floor + BED_LINER_M],
      width: inner - 2 * BED_WALL_M,
    }),
    TRIM,
  );
}

/** Radius of an oldtimer fender at its wheel end. */
const FENDER_RADIUS_M = 0.24;
/** Radius of an oldtimer fender at its tip, away from the wheel. */
const FENDER_TIP_RADIUS_M = 0.17;
/** Length of an oldtimer fender. */
const FENDER_LENGTH_M = 1.05;
/** How far a fender's axis sits above its wheel's axle. */
const FENDER_RISE_M = 0.34;
/** Sides of a fender: round enough to read as a curve. */
const FENDER_SEGMENTS = 10;
/** The running boards reach this far under each fender. */
const BOARD_OVERLAP_M = 0.05;
/** Thickness of a running board under the sill. */
const BOARD_THICKNESS_M = 0.06;

/** A teardrop fender lying along the body: `front` and `rear` are its end radii. */
function fender(front: number, rear: number, at: Point3): BufferGeometry {
  return cylinder({
    radius: rear,
    radiusTop: front,
    length: FENDER_LENGTH_M,
    axis: "x",
    at,
    segments: FENDER_SEGMENTS,
  });
}

/** The oldtimer's four rounded fenders, narrowing away from their wheels, and running boards. */
function addFenders(kit: Kit, profile: CarProfile): void {
  const axleX = kit.length / 2 - profile.axleInset;
  const y = profile.wheel.radius + FENDER_RISE_M;
  const z = kit.width / 2 - FENDER_RADIUS_M;
  for (const side of SIDES) {
    kit.paint(
      fender(FENDER_TIP_RADIUS_M, FENDER_RADIUS_M, [axleX, y, side * z]),
    );
    kit.paint(
      fender(FENDER_RADIUS_M, FENDER_TIP_RADIUS_M, [-axleX, y, side * z]),
    );
  }
  const reach = axleX - FENDER_LENGTH_M / 2 + BOARD_OVERLAP_M;
  mirrored(
    {
      x: [-reach, reach],
      y: [profile.sill - BOARD_THICKNESS_M, profile.sill],
      width: FENDER_RADIUS_M,
      z: kit.width / 2 - FENDER_RADIUS_M / 2,
    },
    (g) => kit.tint(g, TRIM),
  );
}

/** The oldtimer's chrome grille and bumpers, round headlamps and small tail lamps. */
const OLDTIMER_ENDS: readonly Part[] = [
  // Grille, front bumper, rear bumper, headlamps, tail lamps.
  {
    colour: CHROME,
    shape: {
      x: [2.08, 2.19],
      y: [0.45, 0.98],
      width: 0.42,
      taper: { front: 0.06 },
    },
  },
  { colour: CHROME, shape: { x: [2.1, 2.2], y: [0.3, 0.42], width: 1.5 } },
  { colour: CHROME, shape: { x: [-2.2, -2.1], y: [0.3, 0.42], width: 1.5 } },
  {
    colour: HEADLIGHT,
    glow: true,
    mirror: true,
    shape: { radius: 0.1, length: 0.14, axis: "x", at: [1.92, 0.98, 0.5] },
  },
  {
    colour: TAIL_LIGHT,
    glow: true,
    mirror: true,
    shape: { x: [-1.95, -1.86], y: [0.66, 0.76], width: 0.1, z: 0.61 },
  },
];

/** The oldtimer's plates hang on the middle of its chrome bumpers, metres up. */
const OLDTIMER_BUMPER_MIDDLE_M = 0.36;

/** A pre-war saloon: narrow body, separate fenders, running boards, chrome, classic blue plates. */
const oldtimerShape: Shape = (kit) => {
  addCarBody(kit, OLDTIMER);
  addGreenhouse(kit, OLDTIMER, kit.height);
  addFenders(kit, OLDTIMER);
  addParts(kit, OLDTIMER_ENDS);
  const plate = OLDTIMER_BUMPER_MIDDLE_M;
  addPlates(kit, { front: plate, rear: plate }, PLATE_LOOKS.classic);
  return { axles: axlesInset(kit, OLDTIMER.wheel, OLDTIMER.axleInset) };
};

/** Every passenger-type kind's shape. */
export const PASSENGER_SHAPES = {
  compact: (kit) => ({ axles: passengerCar(kit, COMPACT, kit.height) }),
  sedan: (kit) => ({ axles: passengerCar(kit, SEDAN, kit.height) }),
  sport: (kit) => {
    const axles = passengerCar(kit, SPORT, kit.height);
    addParts(kit, SPORT_EXTRAS);
    return { axles };
  },
  police: policeShape,
  van: vanShape,
  pickup: (kit) => {
    const axles = passengerCar(kit, PICKUP, kit.height);
    addPickupBed(kit, PICKUP);
    return { axles };
  },
  oldtimer: oldtimerShape,
} satisfies Record<string, Shape>;
