import { z } from "zod";
import type { Point } from "../world/projection";

const reference = z.string().min(1).max(64);
const seconds = z.number().positive().max(1200);
const target = { target: reference };
const radius = z.number().positive().max(100);

/** Authored objective primitives evaluated only from the authoritative simulation. */
export const PrimitiveObjectiveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("talk"), ...target }),
  z.object({
    kind: z.literal("reach"),
    ...target,
    radius,
    stopped: z.boolean().optional(),
    driving: z.boolean().optional(),
    vehicle: reference.optional(),
  }),
  z.object({ kind: z.literal("interact"), ...target, seconds }),
  z.object({
    kind: z.literal("collect"),
    targets: z.array(reference).min(1).max(8),
  }),
  z.object({
    kind: z.literal("deliver"),
    ...target,
    items: z.array(reference).max(8),
    vehicle: reference.optional(),
  }),
  z.object({ kind: z.literal("enterVehicle"), ...target }),
  z.object({ kind: z.literal("hijackVehicle"), ...target }),
  z.object({
    kind: z.literal("driveCheckpoints"),
    vehicle: reference.optional(),
    gates: z
      .array(z.object({ ...target, radius }))
      .min(2)
      .max(24),
  }),
  z.object({
    kind: z.literal("follow"),
    ...target,
    minimumM: z.number().nonnegative(),
    maximumM: radius,
    seconds,
  }),
  z.object({
    kind: z.literal("identify"),
    ...target,
    clues: z.array(reference).min(2).max(4),
  }),
  z.object({ kind: z.literal("eliminate"), ...target }),
  z.object({
    kind: z.literal("escort"),
    ...target,
    destination: reference,
    radius,
    separationM: radius,
  }),
  z.object({ kind: z.literal("defend"), ...target, seconds }),
  z.object({
    kind: z.literal("escapeWanted"),
    seconds,
    outside: reference.optional(),
    radius: radius.optional(),
  }),
]);

/** A single mechanic, or several mechanics that can be completed in any order. */
export const MissionObjectiveSchema = z.union([
  PrimitiveObjectiveSchema,
  z.object({
    kind: z.literal("composite"),
    objectives: z.array(PrimitiveObjectiveSchema).min(2).max(8),
  }),
]);

/** One mechanical objective including unordered combinations. */
export type MissionObjective = z.infer<typeof MissionObjectiveSchema>;
/** One mechanic without nested combinations. */
export type PrimitiveObjective = z.infer<typeof PrimitiveObjectiveSchema>;

const dialogue = z
  .array(
    z.object({ speaker: z.string().min(1), text: z.string().min(1).max(400) }),
  )
  .min(1)
  .max(6);

/** Mission content validated when the catalogue loads, outside the simulation loop. */
export const MissionDefinitionSchema = z.object({
  id: reference,
  version: z.number().int().positive(),
  title: z.string().min(1),
  contact: reference,
  zone: z.enum(["rhenen", "wageningen", "campus", "bennekom"]),
  prerequisites: z.array(reference),
  estimatedSeconds: seconds,
  deadlineSeconds: seconds.optional(),
  basePay: z.number().int().positive().max(10000),
  bonus: z.object({
    amount: z.number().int().nonnegative().max(10000),
    label: z.string().min(1),
    rule: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("time"), seconds }),
      z.object({
        kind: z.literal("integrity"),
        minimum: z.number().min(0).max(100),
        atCompletion: z.boolean().optional(),
      }),
      z.object({ kind: z.literal("noCivilianKills") }),
      z.object({ kind: z.literal("undetected") }),
      z.object({
        kind: z.literal("optionalItems"),
        items: z.array(reference).min(1),
      }),
    ]),
  }),
  briefing: dialogue,
  success: dialogue,
  failure: z.string().min(1),
  stages: z
    .array(
      z.object({
        id: reference,
        text: z.string().min(1),
        hints: z.tuple([z.string().min(1), z.string().min(1)]),
        dialogue,
        objective: MissionObjectiveSchema,
        deadlineSeconds: seconds.optional(),
        checkpoint: z.boolean().optional(),
        next: reference.optional(),
      }),
    )
    .min(3)
    .max(24),
});

/** One complete authored contract, including Dutch briefing, stages and reward rules. */
export type MissionDefinition = z.infer<typeof MissionDefinitionSchema>;

/** Progress that must survive checkpoints, snapshots and host migration. */
export type ObjectiveProgress = {
  ticks: number;
  gate: number;
  collected: string[];
  suspicion: number;
  lostTicks: number;
  children: ObjectiveProgress[];
  done: boolean;
};

/** World-derived target binding; a client action cannot supply or replace this observation. */
export type MissionTarget = {
  id: number;
  position: Point;
  alive: boolean;
  vehicleId?: number | null;
  clues?: string[];
};

/** Per-tick facts produced by the mission/world adapter after movement and combat. */
export type MissionObservation = {
  tick: number;
  playerId: number;
  position: Point;
  previousPosition: Point;
  teleported: boolean;
  alive: boolean;
  speed: number;
  vehicleId: number | null;
  wanted: number;
  interacting: boolean;
  interacted: boolean;
  targets: Readonly<Record<string, MissionTarget>>;
  kills: readonly { victimId: number; killerId: number | null }[];
  hijackedVehicleIds: readonly number[];
  civilianKills: number;
  minimumIntegrity: number;
  essentialFailure: string | null;
};

/** A contract attempt. Rewards belong to contractId even if an attempt resumes a checkpoint. */
export type MissionRun = {
  contractId: string;
  definitionId: string;
  definitionVersion: number;
  ownerId: number;
  status: "active" | "completed" | "failed" | "abandoned";
  stage: number;
  startedTick: number;
  stageTick: number;
  lastTick: number;
  progressTick: number;
  hint: number;
  objective: ObjectiveProgress;
  inventory: string[];
  detected: boolean;
  civilianKills: number;
  minimumIntegrity: number;
  replay: boolean;
  checkpoint: { stage: number; inventory: string[] } | null;
  failure: string | null;
};

/** Once-only payment receipt stored with the wallet and completed contract IDs. */
export type MissionReceipt = {
  contractId: string;
  missionId: string;
  version: number;
  playerId: number;
  tick: number;
  base: number;
  bonus: number;
  total: number;
};

/** Session economy; spending changes balance but never gross earned cash. */
export type MissionWallet = {
  balance: number;
  earned: number;
  receipts: MissionReceipt[];
};

/** User intent, repeated until the authoritative profile acknowledges its sequence. */
export type MissionCommand = {
  sequence: number;
  kind: "offer" | "accept" | "close" | "hint" | "abandon" | "retry";
  missionId?: string;
};

/** Per-player contract and economy state, carried with the world during host migration. */
export type MissionProfile = {
  records?: Record<
    string,
    { medal: "bronze" | "silver" | "gold"; seconds: number }
  >;
  actors?: Record<string, MissionActorBinding>;
  appliedStage?: number;
  cargoIntegrity?: number;
  offer: string | null;
  run: MissionRun | null;
  wallet: MissionWallet;
  completed: string[];
  cooldownUntil: Record<string, number>;
  lastCommand: number;
  attempt: number;
};

/** Replicated actor identity and AI progress, retained through snapshots and host migration. */
export type MissionActorBinding = {
  id: number;
  routeIndex: number;
  path: Point[];
  nextShot: number;
  vehicleId: number | null;
  driving?: boolean;
};
