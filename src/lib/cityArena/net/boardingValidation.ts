import { z } from "zod";
import type { VehicleBoarding } from "../sim/types";

const integer = z.number().int().nonnegative().max(2_147_483_647);
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);

/** Door transactions carry enough driver state to cancel safely after a host change. */
export const VehicleBoardingSchema: z.ZodType<VehicleBoarding> = z.strictObject(
  {
    ownerId: integer,
    startTick: integer,
    side: z.union([z.literal(-1), z.literal(1)]),
    from: z.tuple([coordinate, coordinate]),
    ejectedId: integer.nullable(),
    driver: z
      .strictObject({
        vehicleId: integer,
        role: z.enum(["traffic", "police"]),
        cruiseMps: z.number().min(0).max(100),
        fromNode: integer.nullable(),
        path: z.array(integer).max(256),
        repathTick: integer,
      })
      .nullable(),
  },
);
