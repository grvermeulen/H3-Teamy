import { z } from "zod";
import { missionById } from "./catalog";
import type { MissionProfile } from "./types";

const tick = z.number().int().min(0).max(2_147_483_647);
const id = z.string().min(1).max(64);
const items = z.array(id).max(32);
const progressFields = {
  ticks: tick,
  gate: z.number().int().min(0).max(24),
  collected: items,
  suspicion: tick,
  lostTicks: tick,
  done: z.boolean(),
};
const progress = z.strictObject({
  ...progressFields,
  children: z
    .array(z.strictObject({ ...progressFields, children: z.tuple([]) }))
    .max(8),
});
const run = z
  .strictObject({
    contractId: id,
    definitionId: id,
    definitionVersion: z.number().int().positive(),
    ownerId: tick,
    status: z.enum(["active", "completed", "failed", "abandoned"]),
    stage: z.number().int().min(0).max(23),
    startedTick: tick,
    stageTick: tick,
    lastTick: tick,
    progressTick: tick,
    hint: z.number().int().min(0).max(2),
    objective: progress,
    inventory: items,
    detected: z.boolean(),
    civilianKills: tick,
    minimumIntegrity: z.number().min(0).max(100),
    replay: z.boolean(),
    checkpoint: z
      .strictObject({
        stage: z.number().int().min(0).max(23),
        inventory: items,
      })
      .nullable(),
    failure: z.string().max(400).nullable(),
  })
  .refine((value) => {
    const definition = missionById(value.definitionId);
    return (
      definition?.version === value.definitionVersion &&
      value.stage < definition.stages.length &&
      (!value.checkpoint || value.checkpoint.stage < definition.stages.length)
    );
  });
const money = z.number().int().min(0).max(10_000_000);

/** Bounded mission state accepted from host snapshots and local saves. */
export const MissionProfileSchema: z.ZodType<MissionProfile> = z
  .strictObject({
    records: z
      .record(
        id,
        z.strictObject({
          medal: z.enum(["bronze", "silver", "gold"]),
          seconds: z.number().finite().min(0).max(100_000_000),
        }),
      )
      .refine((value) => Object.keys(value).length <= 24)
      .optional(),
    actors: z
      .record(
        id,
        z.strictObject({
          id: tick,
          routeIndex: z.number().int().min(0).max(24),
          path: z
            .array(z.tuple([z.number().finite(), z.number().finite()]))
            .max(256),
          nextShot: tick,
          vehicleId: tick.nullable(),
          driving: z.boolean().optional(),
        }),
      )
      .refine((value) => Object.keys(value).length <= 16)
      .optional(),
    appliedStage: z.number().int().min(0).max(23).optional(),
    cargoIntegrity: z.number().min(0).max(100).optional(),
    offer: id.nullable(),
    run: run.nullable(),
    wallet: z.strictObject({
      balance: money,
      earned: money,
      receipts: z
        .array(
          z.strictObject({
            contractId: id,
            missionId: id,
            version: z.number().int().positive(),
            playerId: tick,
            tick,
            base: money,
            bonus: money,
            total: money,
          }),
        )
        .max(24),
    }),
    completed: z.array(id).max(24),
    cooldownUntil: z
      .record(id, tick)
      .refine((value) => Object.keys(value).length <= 24),
    lastCommand: tick,
    attempt: tick,
  })
  .refine(
    (value) =>
      (!value.offer || Boolean(missionById(value.offer))) &&
      value.completed.every((entry) => Boolean(missionById(entry))),
  );
