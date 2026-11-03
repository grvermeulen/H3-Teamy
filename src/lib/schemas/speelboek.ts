import { z } from "zod";

/** Width of the half-pool diagram coordinate space (viewBox units). */
export const DIAGRAM_WIDTH = 300;
/** Height of the half-pool diagram coordinate space (viewBox units). */
export const DIAGRAM_HEIGHT = 150;

/** A point in diagram coordinates: `[x, y]` with the goal at the top. */
export const diagramPointSchema = z.tuple([
  z.number().min(0).max(DIAGRAM_WIDTH),
  z.number().min(0).max(DIAGRAM_HEIGHT),
]);

/** Which side a diagram player belongs to. The keeper is always on the defending side. */
export const diagramTeamSchema = z.enum(["OFF", "DEF", "GK"]);

export const diagramPlayerSchema = z.object({
  /** Stable id used by arrows, the ball and roster roles (e.g. `"p1"`, `"d3"`, `"gk"`). */
  id: z.string().min(1),
  team: diagramTeamSchema,
  x: z.number().min(0).max(DIAGRAM_WIDTH),
  y: z.number().min(0).max(DIAGRAM_HEIGHT),
});

export const diagramArrowSchema = z.object({
  /** `MOVE` = swim action, `PASS` = dashed pass, `SHOT` = thick shot line. */
  kind: z.enum(["MOVE", "PASS", "SHOT"]),
  /** Player the arrow starts from. */
  playerId: z.string().min(1),
  to: diagramPointSchema,
  /** Optional quadratic control point for a curved arrow. */
  via: diagramPointSchema.optional(),
});

/** One snapshot of the pool: who stands where, what moves, who has the ball. */
export const diagramFrameSchema = z.object({
  /** Cap colour of the attacking side; the defence gets the other colour, the keeper red. */
  attackColor: z.enum(["WHITE", "BLUE"]).default("WHITE"),
  players: z.array(diagramPlayerSchema).min(1),
  arrows: z.array(diagramArrowSchema).default([]),
  ballPlayerId: z.string().min(1).optional(),
});

export const drillRoleSchema = z.object({
  playerId: z.string().min(1),
  text: z.string().min(1).max(200),
});

export const drillStepSchema = z.object({
  title: z.string().min(1).max(60),
  text: z.string().min(1).max(400),
  frame: diagramFrameSchema,
  /** What each roster player does in this step. */
  roles: z.array(drillRoleSchema).default([]),
});

/** A player the drill is about: cap label and a short position name.
 * AI `generateObject` schemas: see `src/lib/ai/speelboekGenerate.ts` (strict mode — no
 * `.optional()`; cap numbers in `label`, not optional `number` — Sentry JAVASCRIPT-NEXTJS-4Z). */
export const drillRosterEntrySchema = z.object({
  playerId: z.string().min(1),
  /** Short text inside the cap, usually the position number (`"1"`–`"6"`) or `"K"`. */
  label: z.string().min(1).max(2),
  /** Position name shown next to the role, e.g. `"Vleugel rechts"`. */
  name: z.string().min(1).max(40),
});

export const drillCategorySchema = z.enum([
  "AANVAL",
  "VERDEDIGING",
  "TECHNIEK",
  "KEEPER",
]);

export const drillLevelSchema = z.enum(["BASIS", "GEMIDDELD", "GEVORDERD"]);

export const drillSchema = z.object({
  /** URL slug, e.g. `"tip-in"`. */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id moet een slug zijn"),
  title: z.string().min(1).max(60),
  /** One line under the title in the library. */
  summary: z.string().min(1).max(120),
  category: drillCategorySchema,
  level: drillLevelSchema,
  roster: z.array(drillRosterEntrySchema).min(1),
  steps: z.array(drillStepSchema).min(1),
  /** "Let op" bullets. */
  keyPoints: z.array(z.string().min(1).max(200)).default([]),
  /** "Veelgemaakte fouten" bullets. */
  commonMistakes: z.array(z.string().min(1).max(200)).default([]),
  /** The drill that shows the same situation from the other side (attack <-> defence). */
  counterpartId: z.string().optional(),
  /** `Feedback.id` of the ideeënbus entry this drill came from. */
  sourceFeedbackId: z.string().optional(),
  /** Date added (`YYYY-MM-DD`), used for the "Nieuw" badge. */
  addedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type DiagramPoint = z.infer<typeof diagramPointSchema>;
export type DiagramTeam = z.infer<typeof diagramTeamSchema>;
export type DiagramPlayer = z.infer<typeof diagramPlayerSchema>;
export type DiagramArrow = z.infer<typeof diagramArrowSchema>;
export type DiagramFrame = z.infer<typeof diagramFrameSchema>;
export type DrillRole = z.infer<typeof drillRoleSchema>;
export type DrillStep = z.infer<typeof drillStepSchema>;
export type DrillRosterEntry = z.infer<typeof drillRosterEntrySchema>;
export type DrillCategory = z.infer<typeof drillCategorySchema>;
export type DrillLevel = z.infer<typeof drillLevelSchema>;
export type Drill = z.infer<typeof drillSchema>;
