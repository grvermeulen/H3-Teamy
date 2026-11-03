import { z } from "zod";
import {
  diagramFrameSchema,
  diagramPlayerSchema,
  diagramPointSchema,
  drillCategorySchema,
  drillLevelSchema,
  drillRoleSchema,
  type Drill,
  type DrillStep,
} from "../schemas/speelboek";
import { getStructuredGatewayModel } from "./gatewayModels";

// OpenAI structured-output (strict mode) via the Vercel AI Gateway requires every
// property in `properties` to appear in `required`. Use `.nullable()` instead of
// `.optional()` for omittable fields (same pattern as reportExtractProvider.ts).
// Do not add an optional numeric `number` on roster entries — cap labels belong in
// `label` (see Sentry JAVASCRIPT-NEXTJS-4Z).

const aiDiagramArrowSchema = z.object({
  kind: z.enum(["MOVE", "PASS", "SHOT"]),
  playerId: z.string().min(1),
  to: diagramPointSchema,
  via: diagramPointSchema.nullable(),
});

const aiDiagramFrameSchema = z.object({
  attackColor: z.enum(["WHITE", "BLUE"]),
  players: z.array(diagramPlayerSchema).min(1),
  arrows: z.array(aiDiagramArrowSchema),
  ballPlayerId: z.string().min(1).nullable(),
});

const aiDrillRosterEntrySchema = z.object({
  playerId: z.string().min(1),
  label: z.string().min(1).max(2),
  name: z.string().min(1).max(40),
});

const aiDrillStepSchema = z.object({
  title: z.string().min(1).max(60),
  text: z.string().min(1).max(400),
  frame: aiDiagramFrameSchema,
  roles: z.array(drillRoleSchema),
});

/**
 * Structured output schema for speelboek drill generation (`generateObject`).
 * Kept separate from {@link drillSchema} so defaults and optionals on static
 * content never leak into OpenAI strict mode.
 */
export const SpeelboekGenerateResultSchema = z.object({
  title: z.string().min(1).max(60),
  summary: z.string().min(1).max(120),
  category: drillCategorySchema,
  level: drillLevelSchema,
  roster: z.array(aiDrillRosterEntrySchema).min(1),
  steps: z.array(aiDrillStepSchema).min(1),
  keyPoints: z.array(z.string().min(1).max(200)),
  commonMistakes: z.array(z.string().min(1).max(200)),
});

export type SpeelboekGenerateResult = z.infer<
  typeof SpeelboekGenerateResultSchema
>;

const SYSTEM_PROMPT = `Je bent een waterpolo-trainer die oefeningen voor De Rijn Heren 3 omzet naar gestructureerde speelboek-data (NL).
Gebruik standaard speler-ids: aanvallers p1–p6 (1 rechts, 5 links, 6 midvoor), verdedigers d1–d6, keeper gk.
Zet het cap-nummer in roster.label (string "1"–"6" of "K"), niet in een apart numeriek veld.
Gebruik null voor via, ballPlayerId en andere ontbrekende strings — laat keys niet weg.`;

function normalizeStep(step: SpeelboekGenerateResult["steps"][number]): DrillStep {
  const frame = diagramFrameSchema.parse({
    attackColor: step.frame.attackColor,
    players: step.frame.players,
    arrows: step.frame.arrows.map((arrow) => ({
      kind: arrow.kind,
      playerId: arrow.playerId,
      to: arrow.to,
      ...(arrow.via ? { via: arrow.via } : {}),
    })),
    ...(step.frame.ballPlayerId ? { ballPlayerId: step.frame.ballPlayerId } : {}),
  });
  return {
    title: step.title,
    text: step.text,
    frame,
    roles: step.roles,
  };
}

/**
 * Calls the AI Gateway with a strict-mode-safe schema and returns a partial drill
 * (no id/addedOn) ready for trainer review in the editor.
 */
export async function generateSpeelboekDrillFromDescription(
  description: string,
): Promise<Omit<Drill, "id" | "addedOn">> {
  const { generateObject } = await import("./client");
  const { object } = await generateObject({
    model: getStructuredGatewayModel(),
    schema: SpeelboekGenerateResultSchema,
    system: SYSTEM_PROMPT,
    prompt: description.trim(),
  });
  return {
    title: object.title,
    summary: object.summary,
    category: object.category,
    level: object.level,
    roster: object.roster,
    steps: object.steps.map(normalizeStep),
    keyPoints: object.keyPoints,
    commonMistakes: object.commonMistakes,
  };
}
