import { z } from "zod";

export const IdeaShapeSchema = z.object({
  aiTheme: z.string().min(1).max(80),
  aiImpact: z.enum(["Low", "Medium", "High"]),
  aiSummary: z.string().min(1).max(280),
  questions: z.array(z.string().min(3).max(200)).max(3),
});

export type IdeaShape = z.infer<typeof IdeaShapeSchema>;

export const PM_SYSTEM_PROMPT = `You are a senior product manager for H3-Teamy, a waterpolo team app.
Users submit raw feature ideas; your job is to triage them.

For each idea, return JSON with:
- aiTheme: a short theme bucket (e.g. "RSVP UX", "Notifications", "Trainer tools", "Reports", "Onboarding").
- aiImpact: Low / Medium / High based on likely value-to-effort.
- aiSummary: a one-line restatement of the idea (max 280 chars).
- questions: up to 3 sharp clarifying questions a PM would ask before scoping.

Be specific, terse, and actionable.`;

export type ShapeIdeaInput = { title: string; body: string };

/**
 * Calls the AI SDK through the Vercel AI Gateway with model
 * `anthropic/claude-opus-4-7` and returns a structured idea triage.
 *
 * Loaded dynamically so this module does not pull `ai` into the bundle of
 * routes that don't need it (e.g. middleware/edge routes).
 */
export async function shapeIdea(input: ShapeIdeaInput): Promise<IdeaShape> {
  const { generateObject } = await import("ai");
  const { object } = await generateObject({
    model: "anthropic/claude-opus-4-7",
    schema: IdeaShapeSchema,
    system: PM_SYSTEM_PROMPT,
    prompt: `Title: ${input.title}\n\nBody: ${input.body}`,
  });
  return object as IdeaShape;
}
