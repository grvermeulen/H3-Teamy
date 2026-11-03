import {
  DIAGRAM_HEIGHT,
  DIAGRAM_WIDTH,
  type DiagramArrow,
  type DiagramFrame,
  type DiagramPlayer,
  type DiagramPoint,
  type DiagramTeam,
  type Drill,
  type DrillInput,
  type DrillRosterEntry,
  type DrillStep,
} from "../schemas/speelboek";
import {
  KEEPER_ID,
  STANDARD_POSITIONS,
  STANDARD_ROSTER,
  standardLineup,
} from "./lineup";

/** Hit radius (diagram units) for tapping a cap. */
export const HIT_RADIUS = 13;
/** A pass ending within this distance of a cap hands the ball to that player. */
export const PASS_CATCH_RADIUS = 20;
/** Arrows shorter than this are treated as a tap, not a drag. */
export const MIN_ARROW_LENGTH = 8;

/** Editor tools. `SELECT` drags players; the arrow tools drag from a player to a point. */
export type EditorTool =
  "SELECT" | "MOVE" | "PASS" | "SHOT" | "BALL" | "DELETE";

/** Dutch labels for the editor tools. */
export const TOOL_LABELS: Record<EditorTool, string> = {
  SELECT: "Verplaatsen",
  MOVE: "Zwemactie",
  PASS: "Pass",
  SHOT: "Schot",
  BALL: "Bal geven",
  DELETE: "Verwijderen",
};

/** Empty drill a trainer starts from: standard lineup, six attackers in the roster, one step. */
export function newDrillInput(): DrillInput {
  return {
    title: "",
    summary: "",
    category: "AANVAL",
    level: "BASIS",
    roster: STANDARD_ROSTER.map((r) => ({ ...r })),
    steps: [{ title: "Stap 1", text: "", frame: standardLineup(), roles: [] }],
    keyPoints: [],
    commonMistakes: [],
    published: false,
  };
}

/**
 * Turns an existing drill into editor input (for editing a trainer drill or
 * copying a static one).
 */
export function drillToInput(drill: Drill, published: boolean): DrillInput {
  const {
    id: _id,
    addedOn: _addedOn,
    counterpartId,
    sourceFeedbackId,
    ...rest
  } = drill;
  return {
    ...structuredClone(rest),
    ...(counterpartId ? { counterpartId } : {}),
    ...(sourceFeedbackId ? { sourceFeedbackId } : {}),
    published,
  };
}

function clampPoint([x, y]: DiagramPoint): DiagramPoint {
  return [
    Math.min(Math.max(Math.round(x), 0), DIAGRAM_WIDTH),
    Math.min(Math.max(Math.round(y), 0), DIAGRAM_HEIGHT),
  ];
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** The player under `point`, nearest first, or `null`. */
export function hitTest(
  frame: DiagramFrame,
  point: DiagramPoint,
  radius = HIT_RADIUS,
): string | null {
  let best: { id: string; d: number } | null = null;
  for (const p of frame.players) {
    const d = distance(p.x, p.y, point[0], point[1]);
    if (d <= radius && (!best || d < best.d)) best = { id: p.id, d };
  }
  return best?.id ?? null;
}

/** Moves a player to `point` (clamped to the pool). */
export function movePlayer(
  frame: DiagramFrame,
  playerId: string,
  point: DiagramPoint,
): DiagramFrame {
  const [x, y] = clampPoint(point);
  return {
    ...frame,
    players: frame.players.map((p) => (p.id === playerId ? { ...p, x, y } : p)),
  };
}

/** Adds an arrow from a player to `to`; a shot or pass replaces an earlier arrow of the same kind for that player. */
export function addArrow(
  frame: DiagramFrame,
  arrow: Omit<DiagramArrow, "to"> & { to: DiagramPoint },
): DiagramFrame {
  const to = clampPoint(arrow.to);
  const rest =
    arrow.kind === "MOVE"
      ? frame.arrows
      : frame.arrows.filter(
          (a) => !(a.playerId === arrow.playerId && a.kind === arrow.kind),
        );
  return { ...frame, arrows: [...rest, { ...arrow, to }] };
}

/** Removes every arrow starting from a player. */
export function clearArrowsFor(
  frame: DiagramFrame,
  playerId: string,
): DiagramFrame {
  return {
    ...frame,
    arrows: frame.arrows.filter((a) => a.playerId !== playerId),
  };
}

/** Removes a player with their arrows and, when they hold it, the ball. */
export function removePlayer(
  frame: DiagramFrame,
  playerId: string,
): DiagramFrame {
  return {
    ...frame,
    players: frame.players.filter((p) => p.id !== playerId),
    arrows: frame.arrows.filter((a) => a.playerId !== playerId),
    ballPlayerId:
      frame.ballPlayerId === playerId ? undefined : frame.ballPlayerId,
  };
}

/** Next free id for a side: `p7` after `p1`–`p6`, `d4` when `d4` was removed, etc. */
export function nextPlayerId(frame: DiagramFrame, team: DiagramTeam): string {
  if (team === "GK") return KEEPER_ID;
  const prefix = team === "OFF" ? "p" : "d";
  const used = new Set(frame.players.map((p) => p.id));
  for (let n = 1; n < 20; n++) {
    const id = `${prefix}${n}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${Date.now()}`;
}

/** Adds a player of `team` at `point` (or a free spot near the bottom). Returns the frame and the new id. */
export function addPlayer(
  frame: DiagramFrame,
  team: DiagramTeam,
  point?: DiagramPoint,
): { frame: DiagramFrame; playerId: string } {
  if (team === "GK" && frame.players.some((p) => p.team === "GK")) {
    return { frame, playerId: KEEPER_ID };
  }
  const playerId = nextPlayerId(frame, team);
  const [x, y] = clampPoint(
    point ?? [DIAGRAM_WIDTH / 2, team === "OFF" ? 138 : 128],
  );
  return {
    playerId,
    frame: {
      ...frame,
      players: [...frame.players, { id: playerId, team, x, y }],
    },
  };
}

/** Gives the ball to a player (attackers and defenders alike). */
export function setBall(frame: DiagramFrame, playerId: string): DiagramFrame {
  return { ...frame, ballPlayerId: playerId };
}

/** Swaps which side wears white. */
export function toggleAttackColor(frame: DiagramFrame): DiagramFrame {
  return {
    ...frame,
    attackColor: frame.attackColor === "WHITE" ? "BLUE" : "WHITE",
  };
}

/**
 * The frame the next step starts from: swim arrows are applied to positions,
 * a pass hands the ball to the player it ends at, arrows are cleared.
 */
export function nextStepFrame(frame: DiagramFrame): DiagramFrame {
  const moved = new Map<string, DiagramPoint>();
  for (const a of frame.arrows) {
    if (a.kind === "MOVE") moved.set(a.playerId, a.to);
  }
  const players: DiagramPlayer[] = frame.players.map((p) => {
    const to = moved.get(p.id);
    return to ? { ...p, x: to[0], y: to[1] } : p;
  });
  let ballPlayerId = frame.ballPlayerId;
  const lastPass = [...frame.arrows].reverse().find((a) => a.kind === "PASS");
  if (lastPass) {
    const catcher = hitTest(
      { ...frame, players },
      lastPass.to,
      PASS_CATCH_RADIUS,
    );
    if (catcher) ballPlayerId = catcher;
  }
  return { attackColor: frame.attackColor, players, arrows: [], ballPlayerId };
}

/** Default roster entry for a diagram id: `p3` → "3 · Midden", `d2` → "V2 · Verdediger 2", `gk` → "K · Keeper". */
export function defaultRosterEntry(playerId: string): DrillRosterEntry {
  if (playerId === KEEPER_ID) return { playerId, label: "K", name: "Keeper" };
  const n = Number(playerId.slice(1));
  const standard = (
    STANDARD_POSITIONS as Record<number, { name: string } | undefined>
  )[n];
  if (playerId.startsWith("p")) {
    return {
      playerId,
      label: String(n),
      name: standard?.name ?? `Aanvaller ${n}`,
    };
  }
  return { playerId, label: `V${n}`.slice(0, 2), name: `Verdediger ${n}` };
}

/**
 * Sets or clears the role text of a player in a step. Spaces are kept so a
 * word can still be followed by the next one; only a blank value clears the role.
 */
export function setRole(
  step: DrillStep,
  playerId: string,
  text: string,
): DrillStep {
  const others = step.roles.filter((r) => r.playerId !== playerId);
  if (!text.trim()) return { ...step, roles: others };
  return { ...step, roles: [...others, { playerId, text }] };
}

/** Trims role lines and drops blanks. Used when saving, not while typing. */
export function trimStepRoles(step: DrillStep): DrillStep {
  return {
    ...step,
    roles: step.roles.flatMap((role) => {
      const text = role.text.trim();
      return text ? [{ ...role, text }] : [];
    }),
  };
}

/** Adds a player to the roster (no-op when present) or removes them, dropping their roles in every step. */
export function toggleRoster(input: DrillInput, playerId: string): DrillInput {
  const present = input.roster.some((r) => r.playerId === playerId);
  if (present) {
    return {
      ...input,
      roster: input.roster.filter((r) => r.playerId !== playerId),
      steps: input.steps.map((s) => ({
        ...s,
        roles: s.roles.filter((r) => r.playerId !== playerId),
      })),
    };
  }
  return { ...input, roster: [...input.roster, defaultRosterEntry(playerId)] };
}

/** Splits a textarea into non-empty trimmed lines (for "Let op" and "Veelgemaakte fouten"). */
export function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.slice(0, 200));
}

/**
 * Problems that block saving, in Dutch. Zod gives the final verdict on the server;
 * this catches the obvious ones before the round trip.
 */
export function validateDrillInput(input: DrillInput): string[] {
  const problems: string[] = [];
  if (!input.title.trim()) problems.push("Geef de oefening een titel.");
  if (!input.summary.trim()) problems.push("Schrijf een korte samenvatting.");
  if (input.roster.length === 0) {
    problems.push("Kies minstens één positie die een rol krijgt.");
  }
  input.steps.forEach((s, i) => {
    if (!s.title.trim()) problems.push(`Stap ${i + 1} heeft geen titel.`);
    if (!s.text.trim()) problems.push(`Stap ${i + 1} heeft geen uitleg.`);
    if (s.frame.players.length === 0)
      problems.push(`Stap ${i + 1} heeft geen spelers.`);
  });
  return problems;
}
