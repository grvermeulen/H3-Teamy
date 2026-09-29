import { DEG, ease, lerp, type Vec } from "./math";
import { moveFace, moveProps, samplePose, type MoveName } from "./moves";
import {
  RIGS,
  lerpPose,
  limbPoint,
  rotate,
  solveJoints,
  type Joints,
  type Pose,
} from "./rig";
import type { Anchor, Clip, Cue, FightScript, Hit } from "./script";
import type { Expression, Facing, FighterId, Props } from "./types";

/** The floor line fighters stand on, in world pixels. */
export const FLOOR_Y = 470;

/** Seconds over which a new clip blends in from whatever came before. */
const BLEND = 0.08;

/** A stretch of the real→story mapping. `rate` is story seconds per real second. */
type Segment = { r0: number; s0: number; rate: number; slow: boolean };

/**
 * Maps real (wall-clock) seconds to story seconds: hit-stops freeze the story, slow motion
 * stretches it. Effects keep running through a hit-stop (sparks bloom while the fighters
 * freeze) but slow down with the slow motion.
 */
export class TimeWarp {
  private readonly segments: Segment[] = [];

  /** @param script - The fight whose stops and slow motion to follow. */
  constructor(script: FightScript) {
    type Mark =
      | { t: number; kind: "stop"; dur: number }
      | { t: number; kind: "slow"; rate: number }
      | { t: number; kind: "normal" };
    const marks: Mark[] = [
      ...script.stops.map((s): Mark => ({ t: s.t, kind: "stop", dur: s.dur })),
      ...script.slowmos.flatMap((s): Mark[] => [
        { t: s.t0, kind: "slow", rate: s.rate },
        { t: s.t1, kind: "normal" },
      ]),
    ].sort((a, b) => a.t - b.t);

    let real = 0;
    let story = 0;
    let rate = 1;
    for (const m of marks) {
      if (m.t > story) {
        this.segments.push({ r0: real, s0: story, rate, slow: rate !== 1 });
        real += (m.t - story) / rate;
        story = m.t;
      }
      if (m.kind === "stop") {
        this.segments.push({ r0: real, s0: story, rate: 0, slow: false });
        real += m.dur;
      } else if (m.kind === "slow") rate = m.rate;
      else rate = 1;
    }
    this.segments.push({ r0: real, s0: story, rate, slow: rate !== 1 });
  }

  private segmentAt(real: number): Segment {
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segments[mid].r0 <= real) lo = mid;
      else hi = mid - 1;
    }
    return this.segments[lo];
  }

  /**
   * @param real - Real seconds since the show started.
   * @returns Story seconds.
   */
  storyAt(real: number): number {
    const s = this.segmentAt(Math.max(0, real));
    return s.s0 + (Math.max(0, real) - s.r0) * s.rate;
  }

  /**
   * @param story - Story seconds.
   * @returns The first real second at which the story reaches it.
   */
  realAt(story: number): number {
    let best = 0;
    for (const s of this.segments) {
      if (s.s0 > story) break;
      best = s.rate > 0 ? s.r0 + (story - s.s0) / s.rate : s.r0;
    }
    return best;
  }

  /**
   * @param real - Real seconds.
   * @returns How fast effects run: 1 normally and through hit-stops, slower in slow motion.
   */
  effectRateAt(real: number): number {
    const s = this.segmentAt(real);
    return s.rate === 0 ? 1 : s.rate;
  }

  /**
   * @param real - Real seconds.
   * @returns True while slow motion is on.
   */
  inSlowmo(real: number): boolean {
    return this.segmentAt(real).slow;
  }
}

/** Everything a renderer needs about one fighter at one moment. */
export type FighterState = {
  id: FighterId;
  x: number;
  /** Height above the floor from jumps and launches. */
  y: number;
  facing: Facing;
  pose: Pose;
  joints: Joints;
  /** Whole-body rotation in radians (pose rotation plus clip spin). */
  rot: number;
  face: Expression;
  props: Props;
  clip: Clip | null;
  ghost: boolean;
  aura: boolean;
};

/** Per-script lookups, built once. */
type Index = {
  clips: Record<FighterId, Clip[]>;
  propCues: Record<FighterId, Extract<Cue, { kind: "prop" }>[]>;
  hitsOn: Record<FighterId, Hit[]>;
};

const indexes = new WeakMap<FightScript, Index>();

function indexOf(script: FightScript): Index {
  let idx = indexes.get(script);
  if (!idx) {
    const props = script.cues.filter(
      (c): c is Extract<Cue, { kind: "prop" }> => c.kind === "prop",
    );
    idx = {
      clips: {
        staal: script.clips.filter((c) => c.who === "staal"),
        trump: script.clips.filter((c) => c.who === "trump"),
      },
      propCues: {
        staal: props.filter((c) => c.who === "staal"),
        trump: props.filter((c) => c.who === "trump"),
      },
      hitsOn: {
        staal: script.hits.filter((h) => h.on === "staal"),
        trump: script.hits.filter((h) => h.on === "trump"),
      },
    };
    indexes.set(script, idx);
  }
  return idx;
}

/** The last clip that started at or before `t`, with its index. */
function activeClip(clips: Clip[], t: number): number {
  let lo = 0;
  let hi = clips.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (clips[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Position, lift and spin of a fighter from a clip, without blending. */
function placement(
  c: Clip,
  t: number,
): { x: number; y: number; spin: number; u: number; inside: boolean } {
  const local = t - c.t;
  if (local <= c.dur) {
    const u = c.dur > 0 ? local / c.dur : 1;
    return {
      x: lerp(c.x0, c.x1, ease(c.ease, u)),
      y: Math.max(0, lerp(c.y0, c.y1, u) + 4 * c.arc * u * (1 - u)),
      // Tumbles start slow and whip round: the slow-motion finisher reads before the spin.
      spin: c.spin * u * u,
      u,
      inside: true,
    };
  }
  return { x: c.x1, y: c.y1, spin: c.hold ? c.spin : 0, u: 1, inside: false };
}

/** A fighter's pose from a clip at `t`, without blending. */
function rawPose(who: FighterId, c: Clip | null, t: number): Pose {
  const rig = RIGS[who];
  if (!c) return samplePose("idle", rig, 0, t);
  const local = t - c.t;
  if (local <= c.dur) return samplePose(c.move, rig, local / c.dur, local);
  if (c.hold) return samplePose(c.move, rig, 1, local);
  return samplePose("idle", rig, 0, t);
}

/**
 * Where a fighter stands at `t` (x only), cheap enough to call for facing.
 *
 * @param script - The fight.
 * @param who - The fighter.
 * @param t - Story seconds.
 * @returns World x.
 */
export function fighterX(
  script: FightScript,
  who: FighterId,
  t: number,
): number {
  const clips = indexOf(script).clips[who];
  const i = activeClip(clips, t);
  return i < 0 ? script.start[who] : placement(clips[i], t).x;
}

const RESTING_FACE: Record<FighterId, Expression> = {
  staal: "smirk",
  trump: "smug",
};

const DEFAULT_PROPS: Props = {
  shades: "on",
  can: "none",
  canTilt: 0,
  tieWhip: 0,
  hairLift: 0,
  stars: false,
};

/** Props from prop cues, the playing move, and how hard Trump's hair was hit lately. */
function propsAt(
  script: FightScript,
  who: FighterId,
  t: number,
  c: Clip | null,
): Props {
  const idx = indexOf(script);
  const props: Props = { ...DEFAULT_PROPS };
  for (const cue of idx.propCues[who]) {
    if (cue.t > t) break;
    (props as Record<keyof Props, Props[keyof Props]>)[cue.key] = cue.value;
  }
  if (c && t - c.t <= c.dur)
    Object.assign(props, moveProps(c.move, (t - c.t) / c.dur));
  else if (c?.hold) Object.assign(props, moveProps(c.move, 1));
  if (who === "trump") {
    let lift = 0;
    for (const h of idx.hitsOn.trump) {
      if (h.t > t) break;
      const strength = h.kind === "light" ? 0.35 : h.kind === "super" ? 1 : 0.8;
      lift = Math.max(lift, strength * Math.exp(-(t - h.t) * 4));
    }
    props.hairLift = Math.max(props.hairLift, lift);
  }
  if (c && (c.move === "dizzy" || (c.move === "down" && c.face === "ko")))
    props.stars = true;
  return props;
}

/**
 * A fighter's full state at a moment of story time.
 *
 * @param script - The fight.
 * @param who - The fighter.
 * @param t - Story seconds.
 * @returns Position, pose, joints, face and props.
 */
export function fighterAt(
  script: FightScript,
  who: FighterId,
  t: number,
): FighterState {
  const rig = RIGS[who];
  const clips = indexOf(script).clips[who];
  const i = activeClip(clips, t);
  const c = i >= 0 ? clips[i] : null;

  let pose = rawPose(who, c, t);
  const place = c
    ? placement(c, t)
    : { x: script.start[who], y: 0, spin: 0, u: 0, inside: false };
  if (c && place.inside) {
    const local = t - c.t;
    const blend = Math.min(BLEND, c.dur * 0.3);
    if (local < blend) {
      const prev = i > 0 ? clips[i - 1] : null;
      pose = lerpPose(rawPose(who, prev, t), pose, ease("out", local / blend));
    }
  }

  const other: FighterId = who === "staal" ? "trump" : "staal";
  const dx = fighterX(script, other, t) - place.x;
  const facing: Facing =
    c?.facing ?? (dx === 0 ? (who === "staal" ? 1 : -1) : dx > 0 ? 1 : -1);

  const face: Expression =
    c && (place.inside || c.hold)
      ? (c.face ?? moveFace(c.move) ?? RESTING_FACE[who])
      : RESTING_FACE[who];

  return {
    id: who,
    x: place.x,
    y: place.y,
    facing,
    pose,
    joints: solveJoints(pose, rig),
    rot: (pose.rot + place.spin) * DEG,
    face,
    props: propsAt(script, who, t, c),
    clip: c,
    ghost: Boolean(c?.ghost && place.inside),
    aura: Boolean(c?.aura && (place.inside || c.hold)),
  };
}

/**
 * A fighter posed outside the fight (versus screen, portraits).
 *
 * @param who - The fighter.
 * @param move - The move to sample.
 * @param t - Seconds into the move (loops) — progress is `t` clamped to 0..1.
 * @param facing - Which way to face.
 * @param props - Prop overrides.
 * @returns A state positioned at x 0 on the floor.
 */
export function posedState(
  who: FighterId,
  move: MoveName,
  t: number,
  facing: Facing,
  props: Partial<Props> = {},
): FighterState {
  const rig = RIGS[who];
  const pose = samplePose(move, rig, Math.min(1, Math.max(0, t)), t);
  return {
    id: who,
    x: 0,
    y: 0,
    facing,
    pose,
    joints: solveJoints(pose, rig),
    rot: pose.rot * DEG,
    face: moveFace(move) ?? RESTING_FACE[who],
    props: { ...DEFAULT_PROPS, ...props },
    clip: null,
    ghost: false,
    aura: false,
  };
}

/**
 * The world position of the hip, where the figure is drawn from.
 *
 * @param s - Fighter state.
 * @returns World point.
 */
export function hipWorld(s: FighterState): Vec {
  return {
    x: s.x + s.facing * s.pose.dx,
    y: FLOOR_Y - s.pose.hip - s.y,
  };
}

/**
 * Converts a hip-local point of a fighter to world space.
 *
 * @param s - Fighter state.
 * @param p - Point in hip-local space (facing right, before rotation).
 * @returns World point.
 */
export function toWorld(s: FighterState, p: Vec): Vec {
  const h = hipWorld(s);
  const r = rotate(p, s.rot);
  return { x: h.x + s.facing * r.x, y: h.y + r.y };
}

/**
 * Where an anchor is at `t`.
 *
 * @param script - The fight.
 * @param a - The anchor.
 * @param t - Story seconds.
 * @returns World point.
 */
export function anchorAt(script: FightScript, a: Anchor, t: number): Vec {
  if ("x" in a) return { x: a.x, y: a.y };
  const s = fighterAt(script, a.who, t);
  const p = limbPoint(s.joints, RIGS[a.who], a.limb);
  const w = toWorld(s, p);
  return { x: w.x + s.facing * (a.dx ?? 0), y: w.y + (a.dy ?? 0) };
}

/**
 * Where a projectile is, and how far along.
 *
 * @param script - The fight.
 * @param id - Projectile id.
 * @param t - Story seconds.
 * @returns Position, progress and spin angle; null while it is not in flight.
 */
export function projectileAt(
  script: FightScript,
  id: number,
  t: number,
): { pos: Vec; u: number; angle: number; dir: number } | null {
  const p = script.projectiles[id];
  if (!p || t < p.t0 || t > p.t1) return null;
  const from = anchorAt(script, p.from, p.t0);
  const to = anchorAt(script, p.to, p.t1);
  const u = (t - p.t0) / Math.max(1e-6, p.t1 - p.t0);
  return {
    pos: {
      x: lerp(from.x, to.x, u),
      y: lerp(from.y, to.y, u) - 4 * p.arc * u * (1 - u),
    },
    u,
    angle: p.spin * u * DEG,
    dir: Math.sign(to.x - from.x) || 1,
  };
}

/**
 * Health left, 0..100.
 *
 * @param script - The fight.
 * @param who - The fighter.
 * @param t - Story seconds.
 * @returns Remaining health.
 */
export function healthAt(
  script: FightScript,
  who: FighterId,
  t: number,
): number {
  let hp = 100;
  for (const h of indexOf(script).hitsOn[who]) {
    if (h.t > t) break;
    hp -= h.dmg;
  }
  return Math.max(0, hp);
}

/** Longest gap between blows that still counts as one combo. */
export const COMBO_GAP = 0.95;

/**
 * The combo a fighter is on at `t`.
 *
 * @param script - The fight.
 * @param by - The attacker.
 * @param t - Story seconds.
 * @returns Hits so far and when the last one landed; count 0 when no combo is running.
 */
export function comboAt(
  script: FightScript,
  by: FighterId,
  t: number,
): { count: number; lastT: number } {
  let count = 0;
  let lastT = -Infinity;
  for (const h of script.hits) {
    if (h.t > t) break;
    if (h.by !== by || h.dmg <= 0) continue;
    count = h.t - lastT <= COMBO_GAP ? count + 1 : 1;
    lastT = h.t;
  }
  return { count, lastT };
}

/**
 * The longest combo in the fight.
 *
 * @param script - The fight.
 * @param by - The attacker.
 * @returns Its hit count.
 */
export function maxCombo(script: FightScript, by: FighterId): number {
  let best = 0;
  for (const h of script.hits)
    if (h.by === by) best = Math.max(best, comboAt(script, by, h.t).count);
  return best;
}

/**
 * Staal's super meter, 0..100: it fills with every blow dealt or taken and empties when the
 * super fires.
 *
 * @param script - The fight.
 * @param t - Story seconds.
 * @returns Meter level.
 */
export function meterAt(script: FightScript, t: number): number {
  const superCue = script.cues.find((c) => c.kind === "superFreeze");
  let m = 0;
  for (const h of script.hits) {
    if (h.t > t) break;
    if (superCue && h.t >= superCue.t) break;
    m += h.by === "staal" ? h.dmg * 1.4 : h.dmg * 2.2;
  }
  m = Math.min(100, m);
  if (superCue && t >= superCue.t)
    return Math.max(0, 100 - (t - superCue.t) * 120);
  return m;
}
