import { z } from "zod";
import { getStructuredGatewayModel } from "./gatewayModels";
import {
  DIAGRAM_HEIGHT,
  DIAGRAM_WIDTH,
  drillCategorySchema,
  drillInputSchema,
  drillLevelSchema,
  type DiagramArrow,
  type DiagramFrame,
  type DiagramPlayer,
  type DrillInput,
  type DrillRosterEntry,
} from "../schemas/speelboek";
import {
  KEEPER_ID,
  KEEPER_POSITION,
  POSITION_NUMBERS,
  STANDARD_ROSTER,
  STANDARD_POSITIONS,
  standardLineup,
} from "../speelboek/lineup";

const positionNumber = z.number().int().min(1).max(9);

/**
 * How the model refers to a player: side plus position number (keeper has no number).
 * Fields are `nullable` rather than `optional`: OpenAI's strict JSON-schema mode
 * requires every property to be listed as required.
 */
const aiPlayerRef = z.object({
  team: z.enum(["OFF", "DEF", "GK"]),
  number: positionNumber.nullable(),
});

const aiPlayerSchema = aiPlayerRef.extend({
  x: z.number(),
  y: z.number(),
});

const aiArrowSchema = z.object({
  kind: z.enum(["MOVE", "PASS", "SHOT"]),
  from: aiPlayerRef,
  toX: z.number(),
  toY: z.number(),
});

const aiStepSchema = z.object({
  title: z.string().min(1).max(60),
  text: z.string().min(1).max(400),
  /** Every player on the diagram in this step. Omit a defender for a man-up. */
  players: z.array(aiPlayerSchema).min(1).max(14),
  arrows: z.array(aiArrowSchema).max(12),
  ballHolder: aiPlayerRef.nullable(),
  roles: z
    .array(z.object({ player: aiPlayerRef, text: z.string().min(1).max(200) }))
    .max(13),
});

/** Structured output the model returns; converted to {@link DrillInput} by {@link toDrillInput}. */
export const AiDrillDraftSchema = z.object({
  title: z.string().min(1).max(60),
  summary: z.string().min(1).max(120),
  category: drillCategorySchema,
  level: drillLevelSchema,
  /** The players the drill is about; they get a role line per step. */
  roster: z
    .array(aiPlayerRef.extend({ name: z.string().min(1).max(40) }))
    .min(1)
    .max(13),
  steps: z.array(aiStepSchema).min(1).max(8),
  keyPoints: z.array(z.string().min(1).max(200)).max(6),
  commonMistakes: z.array(z.string().min(1).max(200)).max(6),
});

export type AiDrillDraft = z.infer<typeof AiDrillDraftSchema>;

/** Result of a draft: the editor-ready drill plus hints for the trainer. */
export type DrillDraftResult = {
  draft: DrillInput;
  warnings: string[];
};

const positionsTable = POSITION_NUMBERS.map(
  (n) =>
    `${n} = ${STANDARD_POSITIONS[n].name} (x ${STANDARD_POSITIONS[n].x}, y ${STANDARD_POSITIONS[n].y})`,
).join("\n");

/** System prompt for drafting a drill from a description and/or whiteboard photo. */
export const SPEELBOEK_DRAFT_SYSTEM_PROMPT = `Je bent assistent-trainer van waterpoloteam H3. Je zet de beschrijving van een trainer
(gesproken of getypt, soms met whiteboardfoto) om in een oefening voor het speelboek: stappen met
posities, acties en een korte rol per positie. Schrijf alles in het Nederlands, kort en concreet.

Diagram: bovenaanzicht van een half bad, ${DIAGRAM_WIDTH} breed en ${DIAGRAM_HEIGHT} hoog, doel bovenaan in het
midden (x 150, y 10). Lijnen: 2 m op y 40, 5 m op y 85, 6 m op y 100. Keeper op x 150, y 19.
Standaardopstelling aanval (gezien vanaf de aanval, 1 rechts, 5 links, 6 midvoor):
${positionsTable}
Verdedigers staan tussen hun aanvaller en het doel (team DEF, zelfde nummer als de aanvaller die ze dekken).

Regels:
- Begin vanuit de standaardopstelling en verplaats alleen wat de trainer beschrijft.
- Elke stap bevat ALLE spelers die in beeld zijn (ook de keeper: team GK, number null).
- ballHolder is null als niemand de bal heeft (bijvoorbeeld tijdens een schot).
- Man-meer: laat één verdediger weg. Zone-verdediging: verdedigers op 5–6 m.
- Pijlen: MOVE = zwemactie, PASS = pass, SHOT = schot. Pijl begint bij een speler, eindigt op een coördinaat.
- De bal begint bij een aanvaller (meestal 3) en volgt de passes.
- De volgende stap begint met de eindposities van de vorige.
- roster: alleen de spelers waar de oefening over gaat; geef elke rosterspeler in elke stap één rol-zin.
- Categorie: AANVAL, VERDEDIGING, TECHNIEK of KEEPER. Niveau: BASIS, GEMIDDELD of GEVORDERD.
- Teksten: titel ≤ 60 tekens, samenvatting ≤ 120, staptekst ≤ 400, rol ≤ 200.`;

function refId(ref: {
  team: "OFF" | "DEF" | "GK";
  number?: number | null;
}): string {
  if (ref.team === "GK") return KEEPER_ID;
  const n = Math.min(Math.max(ref.number ?? 1, 1), 9);
  return `${ref.team === "OFF" ? "p" : "d"}${n}`;
}

function clamp(v: number, max: number): number {
  return Math.min(Math.max(Math.round(v), 0), max);
}

function toFrame(step: AiDrillDraft["steps"][number]): DiagramFrame {
  const players = new Map<string, DiagramPlayer>();
  for (const p of step.players) {
    const id = refId(p);
    players.set(id, {
      id,
      team: p.team,
      x: clamp(p.x, DIAGRAM_WIDTH),
      y: clamp(p.y, DIAGRAM_HEIGHT),
    });
  }
  if (!players.has(KEEPER_ID)) {
    players.set(KEEPER_ID, { id: KEEPER_ID, team: "GK", ...KEEPER_POSITION });
  }
  const arrows: DiagramArrow[] = [];
  for (const a of step.arrows) {
    const playerId = refId(a.from);
    if (!players.has(playerId)) continue;
    arrows.push({
      kind: a.kind,
      playerId,
      to: [clamp(a.toX, DIAGRAM_WIDTH), clamp(a.toY, DIAGRAM_HEIGHT)],
    });
  }
  const ball = step.ballHolder ? refId(step.ballHolder) : undefined;
  return {
    attackColor: "WHITE",
    players: Array.from(players.values()),
    arrows,
    ballPlayerId: ball && players.has(ball) ? ball : undefined,
  };
}

/**
 * Converts the model output into a validated {@link DrillInput}, filling gaps
 * (missing keeper, unknown ball holder) and collecting hints for the trainer.
 *
 * @param ai - Structured model output.
 */
export function toDrillInput(ai: AiDrillDraft): DrillDraftResult {
  const warnings: string[] = [];
  const roster: DrillRosterEntry[] = [];
  const seen = new Set<string>();
  for (const r of ai.roster) {
    const playerId = refId(r);
    if (seen.has(playerId)) continue;
    seen.add(playerId);
    roster.push({
      playerId,
      label: r.team === "GK" ? "K" : String(r.number ?? 1),
      name: r.name,
    });
  }
  const steps = ai.steps.map((s) => {
    const frame = toFrame(s);
    const roles = s.roles
      .map((r) => ({ playerId: refId(r.player), text: r.text }))
      .filter((r) => seen.has(r.playerId));
    const withRole = new Set(roles.map((r) => r.playerId));
    for (const entry of roster) {
      if (!withRole.has(entry.playerId)) {
        warnings.push(
          `Stap "${s.title}": geen rol voor ${entry.name} – wil je er een toevoegen?`,
        );
      }
    }
    return { title: s.title, text: s.text, frame, roles };
  });
  const draft = drillInputSchema.parse({
    title: ai.title,
    summary: ai.summary,
    category: ai.category,
    level: ai.level,
    roster: roster.length > 0 ? roster : STANDARD_ROSTER,
    steps,
    keyPoints: ai.keyPoints,
    commonMistakes: ai.commonMistakes,
    published: false,
  });
  return { draft, warnings };
}

/** Describes the standard lineup as JSON for the prompt, so the model copies exact ids and coordinates. */
function lineupHint(): string {
  const frame = standardLineup();
  return JSON.stringify(
    frame.players.map((p) => ({
      team: p.team,
      number: p.team === "GK" ? null : Number(p.id.slice(1)),
      x: p.x,
      y: p.y,
    })),
  );
}

function dataUrlToBuffer(dataUrl: string): {
  buffer: Buffer;
  mediaType: string;
} {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(5, comma);
  const mediaType = meta.split(";")[0];
  return { buffer: Buffer.from(dataUrl.slice(comma + 1), "base64"), mediaType };
}

/**
 * Drafts a drill from a trainer's description and/or whiteboard photo via the
 * AI Gateway (structured output). The result is unpublished and meant to be
 * reviewed in the editor.
 *
 * @param input - Description (may be a speech transcript) and optional image data URL.
 */
export async function draftDrill(input: {
  description: string;
  imageDataUrl?: string;
}): Promise<DrillDraftResult> {
  // Dynamic import keeps the Braintrust-wrapped SDK out of bundles that never call the AI.
  const { generateObject } = await import("./client");
  const text = [
    `Standaardopstelling (team, nummer, x, y): ${lineupHint()}`,
    input.description
      ? `Beschrijving van de trainer:\n${input.description}`
      : "Er is geen tekst; lees de oefening van de whiteboardfoto.",
    input.imageDataUrl
      ? "Op de foto: cirkels/nummers zijn spelers, pijlen zijn acties (gestippeld = pass)."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const content: (
    | { type: "text"; text: string }
    | { type: "image"; image: Buffer; mediaType: string }
  )[] = [{ type: "text", text }];
  if (input.imageDataUrl) {
    const { buffer, mediaType } = dataUrlToBuffer(input.imageDataUrl);
    content.push({ type: "image", image: buffer, mediaType });
  }

  const { object } = await generateObject({
    model: getStructuredGatewayModel(),
    schema: AiDrillDraftSchema,
    system: SPEELBOEK_DRAFT_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  return toDrillInput(object);
}
