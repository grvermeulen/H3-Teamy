import { z } from "zod";
import { getStructuredGatewayModel } from "./gatewayModels";

/**
 * Schema for the structured triage object the AI Product Manager returns for a
 * single user-submitted idea. Drives the `generateObject` call so the model is
 * forced to emit valid, parseable JSON.
 */
export const IdeaShapeSchema = z.object({
  aiTheme: z.string().min(1).max(80),
  aiImpact: z.enum(["Low", "Medium", "High"]),
  aiSummary: z.string().min(1).max(280),
  questions: z.array(z.string().min(3).max(200)).max(3),
});

/** Parsed triage payload: theme bucket, impact tier, summary, and PM questions. */
export type IdeaShape = z.infer<typeof IdeaShapeSchema>;

/**
 * System prompt sent on every triage call. Defines the PM persona, the
 * required JSON fields, and the editorial tone (terse, actionable). Kept as a
 * module-level constant so it's eligible for prompt caching by the gateway.
 */
export const PM_SYSTEM_PROMPT = `You are a senior product manager for H3-Teamy, a waterpolo team app.
Users submit raw feature ideas; your job is to triage them.

For each idea, return JSON with:
- aiTheme: a short theme bucket (e.g. "RSVP UX", "Notifications", "Trainer tools", "Reports", "Onboarding").
- aiImpact: Low / Medium / High based on likely value-to-effort.
- aiSummary: a one-line restatement of the idea (max 280 chars).
- questions: up to 3 sharp clarifying questions a PM would ask before scoping.

Be specific, terse, and actionable.`;

/** Raw idea text passed to the triage call. */
export type ShapeIdeaInput = { title: string; body: string };

/**
 * Calls the AI SDK through the Vercel AI Gateway (structured model from
 * {@link getStructuredGatewayModel}) and returns a structured idea triage.
 *
 * Loaded dynamically so the Braintrust-wrapped client does not pull `ai` /
 * `braintrust` into the bundle of routes that don't need it (e.g. edge).
 */
export async function shapeIdea(input: ShapeIdeaInput): Promise<IdeaShape> {
  const { generateObject } = await import("./client");
  const { object } = await generateObject({
    model: getStructuredGatewayModel(),
    schema: IdeaShapeSchema,
    system: PM_SYSTEM_PROMPT,
    prompt: `Title: ${input.title}\n\nBody: ${input.body}`,
  });
  return object;
}
