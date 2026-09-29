/**
 * The contract between the car pack (`scripts/arena/pack-cars.ts`) and the 3D view that loads it:
 * which vehicle kinds wear a Kenney Car Kit model, the roles a body's triangles are split into,
 * and the manifest the pack writes to `public/arena/cars/manifest.json`. Kept outside `render3d/`
 * so the script can share it without importing the lazily loaded 3D chunk.
 *
 * Every length is in the packed file's own units and frame — x forward, y up, z to the right,
 * origin at the footprint centre on the ground — so the view scales it to the simulation's
 * footprint and the kind's height.
 */
import { z } from "zod";

/** The vehicle kinds drawn with a Kit model; the bus, oldtimer and tank stay procedural. */
export const CAR_KINDS = [
  "compact",
  "sedan",
  "sport",
  "police",
  "van",
  "pickup",
  "tractor",
] as const;

/** A vehicle kind drawn with a Kit model. */
export type CarKind = (typeof CAR_KINDS)[number];

/**
 * What a body's triangles are, each packed as a primitive whose material carries the role's
 * name: the body paint (vertex colours hold its shading, the view tints it per car), everything
 * else in its own colours, the head and tail lamps, and the police light bar's two lenses.
 */
export const CAR_ROLES = [
  "paint",
  "detail",
  "head",
  "tail",
  "lens-left",
  "lens-right",
] as const;

/** A role of a body's triangles. */
export type CarRole = (typeof CAR_ROLES)[number];

/** The four wheels, as their nodes are named in a packed file. */
export const CAR_WHEEL_NODES = [
  "wheel-front-left",
  "wheel-front-right",
  "wheel-back-left",
  "wheel-back-right",
] as const;

/** A wheel node's name. */
export type CarWheelNode = (typeof CAR_WHEEL_NODES)[number];

/** A point in the packed frame. */
const PointSchema = z.tuple([z.number(), z.number(), z.number()]);
/** A closed interval along one axis. */
const SpanSchema = z.tuple([z.number(), z.number()]);

/** One wheel: its node, where its middle is, its radius and width, whether it steers. */
const WheelSchema = z.object({
  node: z.enum(CAR_WHEEL_NODES),
  at: PointSchema,
  radius: z.number().positive(),
  width: z.number().positive(),
  steers: z.boolean(),
});

/** A head or tail lamp: the middle of its face, which end it faces, and whether it is a tail lamp. */
const LampSchema = z.object({
  at: PointSchema,
  facing: z.union([z.literal(1), z.literal(-1)]),
  tail: z.boolean(),
});

/** Where a number plate sits on one end: its face along the body and its middle's height. */
const PlateSchema = z.object({ face: z.number(), height: z.number() });

/** A flat stretch of flank between the wheel arches, where a livery band can go. */
const LiverySchema = z.object({
  x: SpanSchema,
  y: SpanSchema,
  /** How far the flank stands from the centre line. */
  side: z.number().positive(),
});

/** One packed car. */
const CarEntrySchema = z.object({
  file: z.string().min(1),
  /** The Kit model it was packed from. */
  source: z.string().min(1),
  /** Length, height and width of the whole model, wheels included. */
  size: z.tuple([
    z.number().positive(),
    z.number().positive(),
    z.number().positive(),
  ]),
  /** The Kit's own paint colour, sRGB hex: the colour the packed paint shading is relative to. */
  paint: z.number().int().min(0).max(0xffffff),
  wheels: z.array(WheelSchema).length(CAR_WHEEL_NODES.length),
  lamps: z.array(LampSchema),
  plates: z.object({
    front: PlateSchema.nullable(),
    rear: PlateSchema.nullable(),
  }),
  livery: LiverySchema.nullable(),
});

/** `public/arena/cars/manifest.json`. */
export const CarManifestSchema = z.object({
  cars: z.record(z.enum(CAR_KINDS), CarEntrySchema),
});

/** The parsed manifest. */
export type CarManifest = z.infer<typeof CarManifestSchema>;

/** One packed car's entry. */
export type CarEntry = CarManifest["cars"][CarKind];

/**
 * Whether a vehicle kind is drawn with a Kit model.
 *
 * @param kind - Any vehicle kind.
 * @returns `true` for the kinds in {@link CAR_KINDS}.
 */
export function isCarKind(kind: string): kind is CarKind {
  return (CAR_KINDS as readonly string[]).includes(kind);
}
