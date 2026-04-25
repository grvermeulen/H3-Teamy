import { z } from "zod";

/** Allowed values for `Feedback.type` — kept in sync with the Prisma enum. */
export const FEEDBACK_TYPES = ["BUG", "IDEA"] as const;

/** Lifecycle states for a feedback row, mirroring the Prisma `FeedbackStatus` enum. */
export const FEEDBACK_STATUSES = [
  "NEW",
  "TRIAGED",
  "PLANNED",
  "SHIPPED",
  "DECLINED",
] as const;

/**
 * Validation schema for `POST /api/feedback`. Trims and length-bounds the
 * user-supplied fields and rejects unknown feedback types. `route` and
 * `appVersion` are captured client-side and are optional.
 */
export const FeedbackCreateBodySchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(5).max(4000),
  route: z.string().trim().max(500).optional(),
  appVersion: z.string().trim().max(32).optional(),
});

/** Validation schema for the admin status-update endpoint. */
export const FeedbackStatusUpdateBodySchema = z.object({
  status: z.enum(FEEDBACK_STATUSES),
});

/** Parsed body type for `POST /api/feedback`. */
export type FeedbackCreateBody = z.infer<typeof FeedbackCreateBodySchema>;
/** Parsed body type for `PATCH /api/admin/feedback/:id`. */
export type FeedbackStatusUpdateBody = z.infer<
  typeof FeedbackStatusUpdateBodySchema
>;
