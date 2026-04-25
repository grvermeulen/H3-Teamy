import { z } from "zod";

export const FEEDBACK_TYPES = ["BUG", "IDEA"] as const;
export const FEEDBACK_STATUSES = [
  "NEW",
  "TRIAGED",
  "PLANNED",
  "SHIPPED",
  "DECLINED",
] as const;

export const FeedbackCreateBodySchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(5).max(4000),
  route: z.string().trim().max(500).optional(),
  appVersion: z.string().trim().max(32).optional(),
});

export const FeedbackStatusUpdateBodySchema = z.object({
  status: z.enum(FEEDBACK_STATUSES),
});

export type FeedbackCreateBody = z.infer<typeof FeedbackCreateBodySchema>;
export type FeedbackStatusUpdateBody = z.infer<
  typeof FeedbackStatusUpdateBodySchema
>;
