import { z } from "zod";
import { TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026 } from "../knzbVerifiedH3Gap2026";

export const TeamEventImportPresetSchema = z.enum([
  TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026,
]);

export const TeamEventImportInputSchema = z.object({
  title: z.string().min(1).max(200),
  start: z.string().datetime(),
  end: z.string().datetime().optional(),
  location: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  uid: z.string().max(300).optional(),
  /** Indien gezet: moet overeenkomen met `canonicalEventId(title, start)`. */
  id: z.string().max(120).optional(),
});

export const TeamEventHistoryImportBodySchema = z
  .object({
    dryRun: z.boolean().optional().default(true),
    preset: TeamEventImportPresetSchema.optional(),
    events: z.array(TeamEventImportInputSchema).max(25).optional(),
  })
  .refine((body) => Boolean(body.preset) || (body.events?.length ?? 0) > 0, {
    message: "preset_of_events_verplicht",
  });

export type TeamEventImportInput = z.infer<typeof TeamEventImportInputSchema>;
export type TeamEventHistoryImportBody = z.infer<
  typeof TeamEventHistoryImportBodySchema
>;
