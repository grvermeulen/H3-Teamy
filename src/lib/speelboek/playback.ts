import type {
  DiagramArrow,
  DiagramFrame,
  DiagramPlayer,
  DiagramPoint,
  DrillStep,
} from "../schemas/speelboek";

/** A step frozen at progress `t` (0 = this step's positions, 1 = the next step). */
export type PlayedFrame = {
  /** The step being played; arrows stay on these positions while caps move. */
  frame: DiagramFrame;
  /** Where each cap is drawn. Missing ids keep `frame` coordinates. */
  positions: Record<string, { x: number; y: number }>;
  /**
   * Ball anchor in diagram coordinates while a pass is in flight.
   * `null` keeps the ball on `frame.ballPlayerId`.
   */
  ballAt: { x: number; y: number } | null;
};

function clamp01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

/** Slow at the start and end of a swim, linear in the middle. */
function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Point on the quadratic from `start` through `via` to `end`. */
function curve(
  start: DiagramPoint,
  via: DiagramPoint,
  end: DiagramPoint,
  t: number,
): DiagramPoint {
  const u = 1 - t;
  return [
    u * u * start[0] + 2 * u * t * via[0] + t * t * end[0],
    u * u * start[1] + 2 * u * t * via[1] + t * t * end[1],
  ];
}

function lastArrow(
  arrows: readonly DiagramArrow[],
  kind: DiagramArrow["kind"],
  playerId?: string,
): DiagramArrow | undefined {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const arrow = arrows[i];
    if (arrow.kind !== kind) continue;
    if (playerId !== undefined && arrow.playerId !== playerId) continue;
    return arrow;
  }
  return undefined;
}

function playerById(
  players: readonly DiagramPlayer[],
  id: string | undefined,
): DiagramPlayer | undefined {
  if (!id) return undefined;
  return players.find((player) => player.id === id);
}

function travel(
  start: DiagramPoint,
  end: DiagramPoint,
  via: DiagramPoint | undefined,
  t: number,
): { x: number; y: number } {
  const at = via
    ? curve(start, via, end, t)
    : [lerp(start[0], end[0], t), lerp(start[1], end[1], t)];
  return { x: at[0], y: at[1] };
}

/**
 * Positions while step `index` plays toward the next one. Swim arrows
 * (including a curve) are the path; other position changes move in a
 * straight line. `t` is 0 at the start of the step and 1 on arrival.
 */
export function playbackFrame(
  steps: readonly DrillStep[],
  index: number,
  t: number,
): PlayedFrame {
  const step =
    steps[Math.min(Math.max(index, 0), Math.max(steps.length - 1, 0))];
  const from = step?.frame;
  if (!from) {
    return {
      frame: {
        attackColor: "WHITE",
        players: [],
        arrows: [],
      },
      positions: {},
      ballAt: null,
    };
  }
  const next = steps[index + 1]?.frame;
  const eased = smoothstep(t);
  const positions: Record<string, { x: number; y: number }> = {};
  for (const player of from.players) {
    const move = lastArrow(from.arrows, "MOVE", player.id);
    const start: DiagramPoint = [player.x, player.y];
    const nextPlayer = playerById(next?.players ?? [], player.id);
    const end: DiagramPoint = nextPlayer
      ? [nextPlayer.x, nextPlayer.y]
      : (move?.to ?? start);
    positions[player.id] = travel(start, end, move?.via, eased);
  }

  const pass = lastArrow(from.arrows, "PASS");
  const passer = playerById(from.players, pass?.playerId);
  const catcher = playerById(next?.players ?? [], next?.ballPlayerId);
  const ballAt =
    pass && passer
      ? travel(
          [passer.x, passer.y],
          catcher ? [catcher.x, catcher.y] : pass.to,
          pass.via,
          eased,
        )
      : null;

  return { frame: from, positions, ballAt };
}
