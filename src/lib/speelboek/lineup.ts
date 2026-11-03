import type {
  DiagramFrame,
  DiagramPlayer,
  DiagramTeam,
  DrillCategory,
  DrillLevel,
  DrillRosterEntry,
} from "../schemas/speelboek";

/**
 * Standard attacking positions, seen from the attack with the goal at the top:
 * 1 = right wing → 5 = left wing, 6 = centre forward on 2 m.
 */
export const STANDARD_POSITIONS: Record<
  1 | 2 | 3 | 4 | 5 | 6,
  { x: number; y: number; name: string }
> = {
  1: { x: 258, y: 66, name: "Vleugel rechts" },
  2: { x: 232, y: 112, name: "Rechts op 6m" },
  3: { x: 150, y: 118, name: "Midden" },
  4: { x: 70, y: 112, name: "Links op 6m" },
  5: { x: 48, y: 66, name: "Vleugel links" },
  6: { x: 150, y: 58, name: "Midvoor" },
};

/** Position numbers in display order. */
export const POSITION_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

/** Keeper position in front of the goal. */
export const KEEPER_POSITION = { x: 150, y: 19 } as const;

/** Defender per attacking position (d1 marks p1, …, d6 marks the centre forward). */
const STANDARD_DEFENDERS: Record<
  1 | 2 | 3 | 4 | 5 | 6,
  { x: number; y: number }
> = {
  1: { x: 238, y: 74 },
  2: { x: 226, y: 96 },
  3: { x: 150, y: 100 },
  4: { x: 78, y: 96 },
  5: { x: 62, y: 74 },
  6: { x: 150, y: 41 },
};

/** Diagram id of attacking position `n`. */
export function attackerId(n: 1 | 2 | 3 | 4 | 5 | 6): string {
  return `p${n}`;
}

/** Diagram id of the defender marking attacking position `n`. */
export function defenderId(n: 1 | 2 | 3 | 4 | 5 | 6): string {
  return `d${n}`;
}

/** Diagram id of the keeper. */
export const KEEPER_ID = "gk";

/**
 * Builds the standard 6-v-6 frame: attack in white on positions 1–6, a defender
 * on each attacker, keeper on the line, ball at position 3. Override or drop
 * players to describe a situation (e.g. remove `d4` for a man-up).
 *
 * @param overrides - Players to move; matched by id. Unknown ids are appended.
 * @param remove - Player ids to leave out (e.g. an excluded defender).
 * @returns A frame ready to be used as a drill step.
 */
export function standardLineup(
  overrides: DiagramPlayer[] = [],
  remove: string[] = [],
): DiagramFrame {
  const base: DiagramPlayer[] = [
    { id: KEEPER_ID, team: "GK", ...KEEPER_POSITION },
    ...POSITION_NUMBERS.map((n) => ({
      id: defenderId(n),
      team: "DEF" as const,
      ...STANDARD_DEFENDERS[n],
    })),
    ...POSITION_NUMBERS.map((n) => ({
      id: attackerId(n),
      team: "OFF" as const,
      x: STANDARD_POSITIONS[n].x,
      y: STANDARD_POSITIONS[n].y,
    })),
  ];
  const byId = new Map(base.map((p) => [p.id, p]));
  for (const p of overrides) byId.set(p.id, p);
  for (const id of remove) byId.delete(id);
  return {
    attackColor: "WHITE",
    players: Array.from(byId.values()),
    arrows: [],
    ballPlayerId: attackerId(3),
  };
}

/** Roster for the six standard attacking positions. */
export const STANDARD_ROSTER: DrillRosterEntry[] = POSITION_NUMBERS.map(
  (n) => ({
    playerId: attackerId(n),
    label: String(n),
    name: STANDARD_POSITIONS[n].name,
  }),
);

/** Dutch labels for drill categories. */
export const CATEGORY_LABELS: Record<DrillCategory, string> = {
  AANVAL: "Aanval",
  VERDEDIGING: "Verdediging",
  TECHNIEK: "Techniek",
  KEEPER: "Keeper",
};

/** Dutch labels for drill levels. */
export const LEVEL_LABELS: Record<DrillLevel, string> = {
  BASIS: "Basis",
  GEMIDDELD: "Gemiddeld",
  GEVORDERD: "Gevorderd",
};

/** Cap colour used in the role list, matching the diagram. */
export type CapTone = "white" | "blue" | "red";

/**
 * Cap colour for a roster player: attack wears `attackColor`, defence the
 * other colour, the keeper red. A player missing from the frame is coloured
 * from the id (`gk`, `d*`, otherwise attack).
 */
export function rosterCapTone(
  playerId: string,
  frame: Pick<DiagramFrame, "attackColor" | "players">,
): CapTone {
  const listed = frame.players.find((player) => player.id === playerId)?.team;
  const team: DiagramTeam =
    listed ??
    (playerId === KEEPER_ID ? "GK" : playerId.startsWith("d") ? "DEF" : "OFF");
  switch (team) {
    case "GK":
      return "red";
    case "DEF":
      return frame.attackColor === "WHITE" ? "blue" : "white";
    case "OFF":
      return frame.attackColor === "WHITE" ? "white" : "blue";
    default: {
      const exhaustive: never = team;
      return exhaustive;
    }
  }
}
