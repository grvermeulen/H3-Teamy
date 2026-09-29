import type { FightClip } from "./clips";
import type { Ease, Vec } from "./math";
import type { MoveName } from "./moves";
import type { Expression, Facing, FighterId, Limb, Props } from "./types";

/** What kind of blow landed: sets the spark, the sound and how long the frame freezes. */
export type HitKind =
  | "light"
  | "heavy"
  | "kick"
  | "super"
  | "block"
  | "parry"
  | "slap"
  | "whip"
  | "projectile";

/** One move played by one fighter over a stretch of story time. */
export type Clip = {
  who: FighterId;
  t: number;
  dur: number;
  move: MoveName;
  /** World x at the start and end of the clip. */
  x0: number;
  x1: number;
  ease: Ease;
  /** Height above the floor at the start and end, plus a parabolic hop on top. */
  y0: number;
  y1: number;
  arc: number;
  /** Extra whole-body rotation over the clip, in degrees (tumbles, spins). */
  spin: number;
  /** Fixed facing; otherwise the fighter faces the other one. */
  facing?: Facing;
  face?: Expression;
  /** Afterimages trail the fighter. */
  ghost: boolean;
  /** A power aura burns around the fighter. */
  aura: boolean;
  /** Keep the final pose after the clip ends instead of falling back to idle. */
  hold: boolean;
};

/** A point on a fighter's body, or a fixed point in the world. */
export type Anchor =
  | { who: FighterId; limb: Limb; dx?: number; dy?: number }
  | { x: number; y: number };

/** A blow that lands. */
export type Hit = {
  t: number;
  by: FighterId;
  on: FighterId;
  dmg: number;
  kind: HitKind;
  /** Where the spark goes: the attacking limb, or the projectile. */
  at: Anchor | { projectile: number };
  /** Real seconds the frame freezes (hit-stop). */
  stop: number;
  shake: number;
  seed: number;
};

/** Things flying across the stage. */
export type ProjectileKind = "ontslagen" | "can" | "canToss";

/** A projectile, from one anchor to another. */
export type Projectile = {
  id: number;
  kind: ProjectileKind;
  t0: number;
  t1: number;
  from: Anchor;
  to: Anchor;
  arc: number;
  spin: number;
};

/** Big centre-screen callouts. */
export type BannerStyle = "round" | "fight" | "ko" | "win" | "proost";

/** One-off particle bursts not tied to a hit. */
export type BurstKind =
  "dust" | "foam" | "debris" | "burp" | "confetti" | "embers" | "sparkle";

/** Camera focus: the midpoint of the fighters, one fighter, or a fixed point. */
export type CamFocus = "mid" | FighterId | Vec;

/** Everything else that happens on the timeline. */
export type Cue =
  | { kind: "sfx"; t: number; name: FightClip; rate?: number; gain?: number }
  | {
      kind: "music";
      t: number;
      action: "start" | "duck" | "unduck" | "tapeStop";
    }
  | {
      kind: "banner";
      t: number;
      dur: number;
      text: string;
      style: BannerStyle;
    }
  | { kind: "bubble"; t: number; dur: number; who: FighterId; text: string }
  | {
      kind: "popup";
      t: number;
      dur: number;
      text: string;
      at: Anchor;
      color: string;
    }
  | { kind: "superFreeze"; t: number; dur: number; text: string }
  | { kind: "letterbox"; t: number; dur: number }
  | {
      kind: "cam";
      t: number;
      dur: number;
      zoom: number;
      focus: CamFocus;
      ramp: number;
    }
  | { kind: "flash"; t: number; strength: number }
  | { kind: "burst"; t: number; fx: BurstKind; at: Anchor; seed: number }
  | {
      kind: "prop";
      t: number;
      who: FighterId;
      key: keyof Props;
      value: Props[keyof Props];
    }
  | { kind: "hype"; t: number; dur: number }
  | { kind: "endCard"; t: number };

/** A hit-stop: story time freezes at `t` for `dur` real seconds. */
export type Stop = { t: number; dur: number };

/** Slow motion: story time from `t0` to `t1` runs at `rate`. */
export type Slowmo = { t0: number; t1: number; rate: number };

/** The whole fight. Times are story seconds. */
export type FightScript = {
  clips: Clip[];
  hits: Hit[];
  cues: Cue[];
  projectiles: Projectile[];
  stops: Stop[];
  slowmos: Slowmo[];
  /** Where each fighter stands when the stage appears. */
  start: Record<FighterId, number>;
  /** The versus screen runs from 0 to here. */
  vsEnd: number;
  /** Story time at which the show is over. */
  duration: number;
};

/** Options for {@link ScriptBuilder.clip}. */
export type ClipOptions = {
  /** Target world x at the end of the clip. */
  x?: number;
  /** Or: move by this much world x over the clip. */
  dx?: number;
  ease?: Ease;
  y0?: number;
  y1?: number;
  arc?: number;
  spin?: number;
  facing?: Facing;
  face?: Expression;
  ghost?: boolean;
  aura?: boolean;
  hold?: boolean;
};

/** Hit-stop lengths per blow, in real seconds. */
const STOP: Record<HitKind, number> = {
  light: 0.045,
  heavy: 0.08,
  kick: 0.09,
  super: 0.07,
  block: 0.05,
  parry: 0.16,
  slap: 0.07,
  whip: 0.08,
  projectile: 0.08,
};

/** Screen shake per blow, in pixels. */
const SHAKE: Record<HitKind, number> = {
  light: 2,
  heavy: 6,
  kick: 8,
  super: 7,
  block: 2,
  parry: 5,
  slap: 4,
  whip: 5,
  projectile: 6,
};

/**
 * Writes a fight: clips per fighter in time order, blows, projectiles and cues. Positions chain:
 * a clip starts where that fighter's previous clip ended.
 */
export class ScriptBuilder {
  private readonly clips: Clip[] = [];
  private readonly hits: Hit[] = [];
  private readonly cues: Cue[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly stops: Stop[] = [];
  private readonly slowmos: Slowmo[] = [];
  private readonly lastX: Record<FighterId, number>;
  private readonly lastY: Record<FighterId, number> = { staal: 0, trump: 0 };
  private seed = 1;

  /**
   * @param start - Where each fighter stands when the stage appears.
   * @param vsEnd - End of the versus screen.
   */
  constructor(
    private readonly start: Record<FighterId, number>,
    private readonly vsEnd: number,
  ) {
    this.lastX = { ...start };
  }

  /**
   * Adds a clip for one fighter.
   *
   * @param who - The fighter.
   * @param t - Start (story seconds).
   * @param move - What they do.
   * @param dur - For how long.
   * @param o - Movement and styling.
   * @returns The clip's end time, to chain the next beat from.
   */
  clip(
    who: FighterId,
    t: number,
    move: MoveName,
    dur: number,
    o: ClipOptions = {},
  ): number {
    const x0 = this.lastX[who];
    const x1 = o.x ?? x0 + (o.dx ?? 0);
    const y0 = o.y0 ?? this.lastY[who];
    const y1 = o.y1 ?? 0;
    this.clips.push({
      who,
      t,
      dur,
      move,
      x0,
      x1,
      ease: o.ease ?? "out",
      y0,
      y1,
      arc: o.arc ?? 0,
      spin: o.spin ?? 0,
      facing: o.facing,
      face: o.face,
      ghost: o.ghost ?? false,
      aura: o.aura ?? false,
      hold: o.hold ?? false,
    });
    this.lastX[who] = x1;
    this.lastY[who] = y1;
    return t + dur;
  }

  /**
   * Adds a blow. Hit-stop and shake follow the kind unless given.
   *
   * @param t - When it lands.
   * @param by - The attacker.
   * @param dmg - Damage.
   * @param kind - What kind of blow.
   * @param at - Where the spark goes.
   * @param o - Overrides for the freeze and the shake.
   */
  hit(
    t: number,
    by: FighterId,
    dmg: number,
    kind: HitKind,
    at: Hit["at"],
    o: { stop?: number; shake?: number } = {},
  ): void {
    const stop = o.stop ?? STOP[kind];
    this.hits.push({
      t,
      by,
      on: by === "staal" ? "trump" : "staal",
      dmg,
      kind,
      at,
      stop,
      shake: o.shake ?? SHAKE[kind],
      seed: this.seed++,
    });
    if (stop > 0) this.stops.push({ t, dur: stop });
  }

  /**
   * Adds a projectile.
   *
   * @returns Its id, for a hit to anchor its spark to.
   */
  projectile(
    kind: ProjectileKind,
    t0: number,
    t1: number,
    from: Anchor,
    to: Anchor,
    o: { arc?: number; spin?: number } = {},
  ): number {
    const id = this.projectiles.length;
    this.projectiles.push({
      id,
      kind,
      t0,
      t1,
      from,
      to,
      arc: o.arc ?? 0,
      spin: o.spin ?? 0,
    });
    return id;
  }

  /**
   * Where a fighter ends up after the clips written so far.
   *
   * @param who - The fighter.
   * @returns World x.
   */
  xOf(who: FighterId): number {
    return this.lastX[who];
  }

  /**
   * Damage a fighter has dealt in the blows written so far.
   *
   * @param who - The attacker.
   * @returns Total damage.
   */
  damageDealt(who: FighterId): number {
    return this.hits
      .filter((h) => h.by === who)
      .reduce((sum, h) => sum + h.dmg, 0);
  }

  /** Adds a cue (sound, banner, camera move, …). */
  cue(c: Cue): void {
    this.cues.push(c);
  }

  /** Shorthand for a sound cue. */
  sfx(t: number, name: FightClip, rate?: number, gain?: number): void {
    this.cues.push({ kind: "sfx", t, name, rate, gain });
  }

  /** Shorthand for a one-off particle burst. */
  burst(t: number, fx: BurstKind, at: Anchor): void {
    this.cues.push({ kind: "burst", t, fx, at, seed: this.seed++ });
  }

  /** Shorthand for a prop change. */
  prop<K extends keyof Props>(
    t: number,
    who: FighterId,
    key: K,
    value: Props[K],
  ): void {
    this.cues.push({ kind: "prop", t, who, key, value });
  }

  /** Slows story time between `t0` and `t1`. */
  slowmo(t0: number, t1: number, rate: number): void {
    this.slowmos.push({ t0, t1, rate });
  }

  /**
   * Finishes the script. Hit-stops that fall inside slow motion are dropped (the slow motion is
   * the freeze there), and everything is sorted by time.
   *
   * @param duration - Story time at which the show ends.
   * @returns The script.
   */
  build(duration: number): FightScript {
    const inSlowmo = (t: number): boolean =>
      this.slowmos.some((s) => t >= s.t0 && t < s.t1);
    const byT = <T extends { t: number }>(a: T, b: T): number => a.t - b.t;
    return {
      clips: [...this.clips].sort(byT),
      hits: [...this.hits].sort(byT),
      cues: [...this.cues].sort(byT),
      projectiles: [...this.projectiles],
      stops: this.stops.filter((s) => !inSlowmo(s.t)).sort(byT),
      slowmos: [...this.slowmos].sort((a, b) => a.t0 - b.t0),
      start: this.start,
      vsEnd: this.vsEnd,
      duration,
    };
  }
}
