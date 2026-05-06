import { z } from "zod";

/**
 * Schema for the structured nudge object the AI coach returns for a player's
 * 14-day training attendance bucket. Drives the `generateObject` call so the
 * model is forced to emit valid, parseable JSON.
 */
export const AttendanceNudgeSchema = z.object({
  tone: z.enum(["encourage", "cheer"]),
  message: z.string().min(10).max(220),
});

/** Parsed nudge payload: tone bucket and the Dutch message body. */
export type AttendanceNudge = z.infer<typeof AttendanceNudgeSchema>;

/**
 * System prompt sent on every nudge call. Defines the coach persona and the
 * editorial tone (Dutch, warm, never shaming). Kept as a module-level constant
 * so it's eligible for prompt caching by the gateway.
 */
export const NUDGE_SYSTEM_PROMPT = `Je bent de teamcoach-stem in H3-Teamy, de app van waterpolo-team H3.
Je schrijft korte persoonlijke berichten (NL, max 2 zinnen) voor één speler op basis van zijn opkomstcijfer over de laatste 14 dagen.

Twee tones:
- "encourage": speler kwam minder dan de helft van de trainingen. Wees warm, nooit beschamend, nooit moraliserend. Erken dat het leven druk is. Eindig met een concrete uitnodiging voor de eerstvolgende training. Geen verwijten, geen percentages opnoemen.
- "cheer": speler was bij ALLE trainingen. Wees blij en concreet. Eén korte zin van waardering, één zin met positieve impact op het team.

Schrijf in spreektaal, "je"-vorm. Maximaal 2 zinnen, samen onder 220 karakters. Geen emoji-spam (max 1).
Geef JSON terug met velden { tone, message }. Houd "tone" gelijk aan de meegegeven tone.`;

/** Input for the nudge call: bucket + raw counts so the model can personalize. */
export type NudgeInput = {
  tone: "encourage" | "cheer";
  attended: number;
  total: number;
  firstName?: string;
};

/**
 * Calls the AI SDK through the Vercel AI Gateway with model
 * `anthropic/claude-opus-4` and returns a structured attendance nudge.
 *
 * Loaded dynamically so the Braintrust-wrapped client does not pull `ai` /
 * `braintrust` into the bundle of routes that don't need it (e.g. edge).
 */
export async function generateAttendanceNudge(
  input: NudgeInput,
): Promise<AttendanceNudge> {
  const { generateObject } = await import("./client");
  const namePart = input.firstName ? `Voornaam: ${input.firstName}\n` : "";
  const { object } = await generateObject({
    model: "anthropic/claude-opus-4",
    schema: AttendanceNudgeSchema,
    system: NUDGE_SYSTEM_PROMPT,
    prompt: `${namePart}Tone: ${input.tone}\nAanwezig: ${input.attended} van ${input.total} trainingen (laatste 14 dagen).`,
  });
  return object;
}
