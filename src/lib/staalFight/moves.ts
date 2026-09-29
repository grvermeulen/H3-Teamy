import { ease, lerp, type Ease } from "./math";
import {
  lerpPose,
  resolvePose,
  type Pose,
  type PoseSpec,
  type Rig,
} from "./rig";
import type { Expression, Props } from "./types";

/** One keyframe: a pose at a point of the move's normalised progress. */
type Key = { u: number; p: PoseSpec; ease?: Ease };

/** A keyframed move, or a procedural one (idle, walking, windmilling) computed from time. */
type MoveDef = {
  keys?: readonly Key[];
  /**
   * Procedural pose: `u` is clip progress, `t` seconds into the clip, `st` the fighter's stance
   * (so a loop can breathe around whoever plays it).
   */
  fn?: (u: number, t: number, st: PoseSpec) => PoseSpec;
  /** Face while the move plays, unless the clip says otherwise. */
  face?: Expression;
  /** Props the move animates by itself (the tie whip, the can tipping). */
  props?: (u: number) => Partial<Props>;
};

/** Short-hands for poses that recur. */
const LYING: PoseSpec = {
  rot: -90,
  torso: 0,
  head: 10,
  hip: 21,
  sF: 40,
  eF: 30,
  sB: 150,
  eB: 20,
  hF: 8,
  kF: -8,
  hB: -6,
  kB: -30,
};
const AIR_TUCK: PoseSpec = {
  hip: 92,
  hF: 55,
  kF: -105,
  hB: 15,
  kB: -110,
  torso: 6,
  sF: 60,
  eF: 100,
  sB: 40,
  eB: 110,
};
const HOLD_CAN: PoseSpec = { sF: 30, eF: 108, handF: "grip" };

/** Phase of a loop in radians. */
function wave(t: number, hz: number, phase = 0): number {
  return Math.sin(t * hz * Math.PI * 2 + phase);
}

/** Every move either fighter can play. */
export const MOVES = {
  idle: {
    fn: (_u, t, st) => ({
      torso: (st.torso ?? 0) + wave(t, 1.6) * 1.8,
      hip: (st.hip ?? 90) + wave(t, 1.6, 1) * 1.6,
      eF: (st.eF ?? 90) + wave(t, 1.6, 0.6) * 5,
      eB: (st.eB ?? 90) + wave(t, 1.6, 1.4) * 5,
    }),
  },
  walk: {
    fn: (_u, t, st) => {
      const ph = t * 1.9 * Math.PI * 2;
      return {
        fF: [28 + Math.sin(ph) * 16, Math.max(0, Math.cos(ph)) * 9],
        fB: [-30 - Math.sin(ph) * 16, Math.max(0, -Math.cos(ph)) * 9],
        hip: (st.hip ?? 90) + 2 + Math.abs(Math.sin(ph)) * 2,
      };
    },
  },
  dash: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.3,
        p: {
          torso: 34,
          hip: 78,
          fF: [52, 8],
          fB: [-62, 10],
          sF: 30,
          eF: 95,
          sB: -30,
          eB: 60,
        },
        ease: "out",
      },
      {
        u: 0.75,
        p: {
          torso: 30,
          hip: 80,
          fF: [44, 0],
          fB: [-56, 4],
          sF: 40,
          eF: 100,
          sB: -20,
          eB: 70,
        },
      },
      { u: 1, p: {} },
    ],
    face: "grit",
  },
  jab: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.3,
        p: { torso: 16, sF: 88, eF: 2, dx: 10, fF: [44, 0] },
        ease: "snap",
      },
      { u: 1, p: {} },
    ],
    face: "grit",
  },
  cross: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.32,
        p: {
          torso: 24,
          sB: 88,
          eB: 2,
          sF: 40,
          eF: 120,
          dx: 14,
          fF: [46, 0],
          fB: [-34, 0],
        },
        ease: "snap",
      },
      { u: 1, p: {} },
    ],
    face: "grit",
  },
  hook: {
    keys: [
      { u: 0, p: {} },
      { u: 0.2, p: { torso: 2, sF: 30, eF: 62, dx: -4 } },
      {
        u: 0.45,
        p: { torso: 22, sF: 84, eF: 72, dx: 12, fF: [44, 0] },
        ease: "snap",
      },
      { u: 1, p: {} },
    ],
    face: "grit",
  },
  body: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.35,
        p: {
          torso: 32,
          hip: 72,
          sF: 64,
          eF: 12,
          fF: [54, 0],
          fB: [-46, 0],
          dx: 12,
        },
        ease: "snap",
      },
      { u: 1, p: {} },
    ],
    face: "shout",
  },
  uppercut: {
    keys: [
      { u: 0, p: {} },
      { u: 0.25, p: { torso: 26, hip: 70, sF: 25, eF: 70, fF: [44, 0] } },
      {
        u: 0.5,
        p: { torso: -4, hip: 90, sF: 130, eF: 22, dx: 12, fF: [40, 0] },
        ease: "snap",
      },
      { u: 0.7, p: { torso: -8, hip: 94, sF: 165, eF: 15, dx: 12 } },
      { u: 1, p: {} },
    ],
    face: "shout",
  },
  launcher: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.22,
        p: { torso: 30, hip: 64, sF: 12, eF: 62, fF: [44, 0], fB: [-44, 0] },
      },
      {
        u: 0.45,
        p: {
          torso: -8,
          hip: 96,
          sF: 110,
          eF: 18,
          hF: 50,
          kF: -70,
          hB: -10,
          kB: -30,
          dx: 14,
        },
        ease: "snap",
      },
      {
        u: 1,
        p: {
          torso: -4,
          hip: 100,
          sF: 172,
          eF: 8,
          hF: 40,
          kF: -60,
          hB: -15,
          kB: -50,
          dx: 14,
        },
      },
    ],
    face: "shout",
  },
  knee: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.35,
        p: {
          torso: -4,
          hF: 100,
          kF: -125,
          fB: [-14, 0],
          sF: 70,
          eF: 40,
          sB: 60,
          eB: 50,
          hip: 96,
          dx: 12,
        },
        ease: "snap",
      },
      { u: 1, p: {} },
    ],
    face: "shout",
  },
  elbow: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.35,
        p: { torso: 24, sF: 98, eF: 160, dx: 14, fF: [48, 0] },
        ease: "snap",
      },
      { u: 1, p: {} },
    ],
    face: "grit",
  },
  kickHigh: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.2,
        p: { hF: 70, kF: -110, torso: -8, fB: [-16, 0], hip: 96 },
      },
      {
        u: 0.45,
        p: {
          hF: 118,
          kF: -4,
          torso: -32,
          fB: [-18, 0],
          hip: 98,
          sF: 40,
          eF: 110,
          sB: -20,
          eB: 60,
        },
        ease: "snap",
      },
      { u: 1, p: {} },
    ],
    face: "shout",
  },
  roundhouse: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.25,
        p: { torso: -10, hB: 20, kB: -120, fF: [10, 0], hip: 96 },
      },
      {
        u: 0.5,
        p: {
          hB: 112,
          kB: -4,
          torso: -34,
          fF: [4, 0],
          hip: 98,
          sF: 20,
          eF: 80,
          sB: 60,
          eB: 110,
        },
        ease: "snap",
      },
      { u: 1, p: {} },
    ],
    face: "shout",
  },
  sweep: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.3,
        p: {
          hip: 44,
          torso: 34,
          hF: 84,
          kF: 0,
          fB: [-26, 0],
          sF: 40,
          eF: 20,
          sB: 100,
          eB: 40,
        },
        ease: "snap",
      },
      {
        u: 0.72,
        p: {
          hip: 44,
          torso: 34,
          hF: 84,
          kF: 0,
          fB: [-26, 0],
          sF: 40,
          eF: 20,
          sB: 100,
          eB: 40,
        },
      },
      { u: 1, p: {} },
    ],
    face: "grit",
  },
  jump: {
    keys: [
      { u: 0, p: { hip: 72, torso: 20 } },
      { u: 0.3, p: AIR_TUCK, ease: "out" },
      { u: 1, p: AIR_TUCK },
    ],
    face: "grit",
  },
  airKick: {
    keys: [
      { u: 0, p: AIR_TUCK },
      {
        u: 0.35,
        p: {
          hip: 92,
          hF: 86,
          kF: -2,
          hB: -30,
          kB: -90,
          torso: -14,
          sF: 60,
          eF: 100,
          sB: -30,
          eB: 60,
        },
        ease: "snap",
      },
      { u: 1, p: AIR_TUCK },
    ],
    face: "shout",
  },
  airPunch: {
    keys: [
      { u: 0, p: AIR_TUCK },
      {
        u: 0.35,
        p: { ...AIR_TUCK, torso: 30, sF: 55, eF: 0 },
        ease: "snap",
      },
      { u: 1, p: AIR_TUCK },
    ],
    face: "shout",
  },
  axeKick: {
    keys: [
      {
        u: 0,
        p: {
          hip: 92,
          hF: 150,
          kF: -10,
          hB: -20,
          kB: -60,
          torso: -20,
          sF: 150,
          eF: 10,
          sB: 150,
          eB: 10,
        },
      },
      {
        u: 0.4,
        p: {
          hip: 92,
          hF: 50,
          kF: -5,
          hB: -10,
          kB: -80,
          torso: 25,
          sF: 30,
          eF: 60,
          sB: 20,
          eB: 60,
        },
        ease: "snap",
      },
      {
        u: 1,
        p: { hip: 92, hF: 30, kF: -40, hB: -10, kB: -70, torso: 10 },
      },
    ],
    face: "shout",
  },
  land: {
    keys: [
      { u: 0, p: { hip: 92, hF: 30, kF: -60, hB: -10, kB: -60 } },
      {
        u: 0.35,
        p: { hip: 62, torso: 22, fF: [42, 0], fB: [-42, 0] },
        ease: "out",
      },
      { u: 1, p: {} },
    ],
    face: "grit",
  },
  parry: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.3,
        p: { torso: 6, sF: 100, eF: 8, handF: "open", dx: 6 },
        ease: "snap",
      },
      { u: 0.7, p: { torso: 6, sF: 100, eF: 8, handF: "open", dx: 6 } },
      { u: 1, p: {} },
    ],
    face: "grit",
  },
  block: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.25,
        p: { torso: -6, sF: 62, eF: 128, sB: 72, eB: 118, hip: 82, dx: -4 },
        ease: "out",
      },
      {
        u: 0.8,
        p: { torso: -6, sF: 62, eF: 128, sB: 72, eB: 118, hip: 82, dx: -4 },
      },
      { u: 1, p: {} },
    ],
    face: "grit",
  },
  shades: {
    keys: [
      { u: 0, p: {} },
      { u: 0.35, p: { torso: 4, head: -6, reachF: "eyes", handF: "open" } },
      { u: 0.7, p: { torso: 4, head: -9, reachF: "eyes", handF: "open" } },
      { u: 1, p: {} },
    ],
    face: "smirk",
  },
  shadesDown: {
    keys: [
      { u: 0, p: {} },
      { u: 0.3, p: { torso: 6, head: 12, reachF: "eyes", handF: "grip" } },
      { u: 0.8, p: { torso: 6, head: 14, reachF: "eyes", handF: "grip" } },
      { u: 1, p: { torso: 6, head: 10 } },
    ],
    face: "smirk",
  },
  crack: {
    keys: [
      { u: 0, p: {} },
      { u: 0.3, p: { torso: 4, sF: 60, eF: 112, sB: 70, eB: 100 } },
      { u: 0.45, p: { torso: 4, sF: 64, eF: 104, sB: 66, eB: 108 } },
      { u: 0.6, p: { torso: 4, sF: 60, eF: 112, sB: 70, eB: 100 } },
      { u: 0.8, p: { torso: 6, head: -20 }, ease: "snap" },
      { u: 1, p: {} },
    ],
    face: "smirk",
  },
  beckon: {
    keys: [
      { u: 0, p: {} },
      { u: 0.2, p: { torso: -2, sF: 82, eF: 18, handF: "open", head: -6 } },
      { u: 0.4, p: { torso: -2, sF: 82, eF: 82, handF: "open", head: -6 } },
      { u: 0.6, p: { torso: -2, sF: 82, eF: 18, handF: "open", head: -6 } },
      { u: 0.8, p: { torso: -2, sF: 82, eF: 82, handF: "open", head: -6 } },
      { u: 1, p: {} },
    ],
    face: "smirk",
  },
  powerUp: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.3,
        p: {
          torso: 16,
          hip: 70,
          fF: [48, 0],
          fB: [-54, 0],
          sF: 30,
          eF: 122,
          sB: 30,
          eB: 122,
        },
      },
      {
        u: 0.55,
        p: {
          torso: -6,
          hip: 80,
          fF: [48, 0],
          fB: [-54, 0],
          sF: 16,
          eF: 24,
          sB: -14,
          eB: 20,
          head: -16,
        },
        ease: "back",
      },
      {
        u: 1,
        p: {
          torso: -4,
          hip: 80,
          fF: [48, 0],
          fB: [-54, 0],
          sF: 18,
          eF: 24,
          sB: -12,
          eB: 20,
          head: -14,
        },
      },
    ],
    face: "shout",
  },
  hurtHigh: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.25,
        p: {
          torso: -26,
          head: -24,
          sF: 20,
          eF: 30,
          sB: -10,
          eB: 30,
          dx: -8,
          hip: 88,
        },
        ease: "snap",
      },
      { u: 1, p: { torso: -4, head: -4 } },
    ],
    face: "hurt",
  },
  hurtGut: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.25,
        p: {
          torso: 42,
          head: 18,
          hip: 80,
          sF: 30,
          eF: 70,
          sB: 20,
          eB: 80,
          dx: -6,
        },
        ease: "snap",
      },
      { u: 1, p: { torso: 14 } },
    ],
    face: "hurt",
  },
  rush: {
    // Ten punches a second, front and back hand in turn.
    fn: (_u, t) => {
      const beat = t * 10;
      const front = Math.floor(beat) % 2 === 0;
      const e = Math.sin((beat % 1) * Math.PI);
      return {
        torso: 18 + e * 6,
        hip: 82,
        fF: [48, 0],
        fB: [-44, 0],
        dx: front ? 10 : 10 + e * 12,
        sF: front ? lerp(60, 90, e) : 50,
        eF: front ? lerp(100, 2, e) : 110,
        sB: front ? 35 : lerp(35, 90, e),
        eB: front ? 118 : lerp(118, 2, e),
      };
    },
    face: "shout",
  },
  shaken: {
    // A rapid flurry landing: small back-and-forth jolts, the body giving ground.
    fn: (_u, t, st) => ({
      torso: -12 + Math.sin(t * 60) * 8,
      head: -14 + Math.sin(t * 60 + 1) * 10,
      sF: 20,
      eF: 40,
      sB: 0,
      eB: 40,
      hip: (st.hip ?? 90) - 4,
      dx: Math.sin(t * 60) * 3,
    }),
    face: "hurt",
  },
  launched: {
    keys: [
      {
        u: 0,
        p: {
          torso: -30,
          head: -30,
          rot: -30,
          sF: 150,
          eF: 20,
          sB: 170,
          eB: 10,
          hF: 30,
          kF: -40,
          hB: -10,
          kB: -20,
          hip: 92,
        },
      },
      {
        u: 1,
        p: {
          torso: -20,
          head: -20,
          rot: -70,
          sF: 160,
          eF: 40,
          sB: 190,
          eB: 20,
          hF: 40,
          kF: -20,
          hB: 0,
          kB: -40,
          hip: 92,
        },
      },
    ],
    face: "hurt",
  },
  fallDown: {
    keys: [
      {
        u: 0,
        p: {
          torso: -20,
          head: -20,
          rot: -60,
          sF: 160,
          eF: 40,
          sB: 190,
          eB: 20,
          hF: 40,
          kF: -20,
          hB: 0,
          kB: -40,
          hip: 60,
        },
      },
      { u: 1, p: LYING, ease: "in" },
    ],
    face: "hurt",
  },
  down: {
    fn: (_u, t) => ({ ...LYING, torso: wave(t, 0.6) * 2 }),
    face: "ko",
  },
  bounce: {
    keys: [
      { u: 0, p: LYING },
      { u: 0.5, p: { ...LYING, rot: -70, hF: 30, kF: -40, sB: 170 } },
      { u: 1, p: LYING },
    ],
    face: "hurt",
  },
  getUp: {
    keys: [
      { u: 0, p: LYING },
      {
        u: 0.35,
        p: {
          rot: -40,
          hip: 40,
          torso: 10,
          hF: 70,
          kF: -120,
          hB: 40,
          kB: -100,
          sB: 60,
          eB: 10,
          sF: 30,
          eF: 20,
        },
      },
      {
        u: 0.7,
        p: { rot: 0, hip: 66, torso: 30, fF: [34, 0], fB: [-34, 0] },
      },
      { u: 1, p: {} },
    ],
    face: "angry",
  },
  dizzy: {
    fn: (_u, t, st) => ({
      torso: 4 + wave(t, 0.7) * 10,
      head: wave(t, 0.9, 1) * 14,
      sF: 12,
      eF: 22,
      sB: 8,
      eB: 18,
      hip: (st.hip ?? 90) - 4,
      fF: [22 + wave(t, 0.7) * 6, 0],
      fB: [-30 + wave(t, 0.7) * 6, 0],
      handF: "open",
      handB: "open",
    }),
    face: "dizzy",
  },
  wallSplat: {
    keys: [
      {
        u: 0,
        p: {
          torso: -6,
          head: -10,
          sF: 150,
          eF: 10,
          sB: -150,
          eB: -10,
          hF: 20,
          kF: -10,
          hB: -20,
          kB: -10,
          hip: 100,
          handF: "open",
          handB: "open",
        },
      },
      {
        u: 1,
        p: {
          torso: -2,
          head: 16,
          sF: 130,
          eF: 20,
          sB: -130,
          eB: -20,
          hF: 16,
          kF: -16,
          hB: -16,
          kB: -16,
          hip: 100,
          handF: "open",
          handB: "open",
        },
      },
    ],
    face: "ko",
  },
  slap: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.35,
        p: { torso: -10, sF: -40, eF: 50, handF: "open", head: -6 },
      },
      {
        u: 0.55,
        p: {
          torso: 18,
          sF: 95,
          eF: 6,
          handF: "open",
          dx: 12,
          fF: [36, 0],
        },
        ease: "snap",
      },
      { u: 1, p: {} },
    ],
    face: "angry",
  },
  point: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.3,
        p: { torso: 12, sF: 92, eF: 0, handF: "point", head: 4, dx: 6 },
        ease: "snap",
      },
      {
        u: 0.85,
        p: { torso: 12, sF: 92, eF: 0, handF: "point", head: 4, dx: 6 },
      },
      { u: 1, p: {} },
    ],
    face: "shout",
  },
  windmill: {
    fn: (u, t) => {
      const spin = -60 + u * 1150;
      const ph = t * 2.6 * Math.PI * 2;
      return {
        torso: 16,
        sF: spin,
        eF: 18,
        sB: spin + 180,
        eB: 18,
        handF: "open",
        handB: "open",
        fF: [28 + Math.sin(ph) * 12, Math.max(0, Math.cos(ph)) * 8],
        fB: [-30 - Math.sin(ph) * 12, Math.max(0, -Math.cos(ph)) * 8],
      };
    },
    face: "shout",
  },
  tieWhip: {
    keys: [
      { u: 0, p: {} },
      { u: 0.3, p: { torso: -14, sF: 150, eF: 30, handF: "grip", head: -8 } },
      {
        u: 0.5,
        p: { torso: 20, sF: 84, eF: 0, handF: "grip", dx: 10, fF: [36, 0] },
        ease: "snap",
      },
      {
        u: 0.8,
        p: { torso: 20, sF: 84, eF: 0, handF: "grip", dx: 10, fF: [36, 0] },
      },
      { u: 1, p: {} },
    ],
    face: "shout",
    props: (u) => ({
      tieWhip:
        u < 0.35
          ? 0
          : u < 0.5
            ? ease("snap", (u - 0.35) / 0.15)
            : u < 0.8
              ? 1
              : 1 - (u - 0.8) / 0.2,
    }),
  },
  gloat: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.3,
        p: {
          torso: -12,
          head: -18,
          sF: 75,
          eF: 15,
          sB: -65,
          eB: 10,
          handF: "open",
          handB: "open",
        },
        ease: "back",
      },
      {
        u: 0.55,
        p: {
          torso: -14,
          head: -20,
          sF: 80,
          eF: 18,
          sB: -70,
          eB: 12,
          handF: "open",
          handB: "open",
          hip: 96,
        },
      },
      {
        u: 0.8,
        p: {
          torso: -12,
          head: -18,
          sF: 75,
          eF: 15,
          sB: -65,
          eB: 10,
          handF: "open",
          handB: "open",
        },
      },
      { u: 1, p: {} },
    ],
    face: "smug",
  },
  catchCan: {
    keys: [
      { u: 0, p: {} },
      { u: 0.4, p: { torso: 2, sF: 165, eF: 10, handF: "grip" }, ease: "snap" },
      { u: 1, p: HOLD_CAN },
    ],
    face: "smirk",
  },
  holdCan: {
    fn: (_u, t) => ({
      ...HOLD_CAN,
      torso: 6 + wave(t, 1.2) * 1.5,
      hip: 88 + wave(t, 1.2, 1),
      sB: 20,
      eB: 30,
    }),
    face: "smirk",
  },
  openCan: {
    keys: [
      { u: 0, p: HOLD_CAN },
      {
        u: 0.4,
        p: { ...HOLD_CAN, sF: 36, sB: 44, eB: 116, handB: "open", head: 12 },
      },
      {
        u: 0.6,
        p: { ...HOLD_CAN, sF: 32, eF: 100, sB: 30, eB: 100, head: 8 },
      },
      { u: 1, p: HOLD_CAN },
    ],
    face: "smirk",
  },
  proost: {
    keys: [
      { u: 0, p: HOLD_CAN },
      {
        u: 0.35,
        p: { torso: -4, sF: 140, eF: 20, handF: "grip", head: -8 },
        ease: "back",
      },
      { u: 0.8, p: { torso: -4, sF: 142, eF: 22, handF: "grip", head: -8 } },
      { u: 1, p: HOLD_CAN },
    ],
    face: "shout",
  },
  drink: {
    keys: [
      { u: 0, p: HOLD_CAN },
      {
        u: 0.2,
        p: { torso: -8, head: -26, reachF: "mouth", handF: "grip" },
      },
      {
        u: 0.9,
        p: { torso: -16, head: -40, reachF: "mouth", handF: "grip" },
      },
      {
        u: 1,
        p: { torso: -14, head: -36, reachF: "mouth", handF: "grip" },
      },
    ],
    face: "drink",
    props: (u) => ({ canTilt: u < 0.2 ? u / 0.2 : 1 }),
  },
  aah: {
    keys: [
      { u: 0, p: { torso: -14, head: -36, reachF: "mouth", handF: "grip" } },
      { u: 0.4, p: { torso: 2, head: 8, sF: 42, eF: 92, handF: "grip" } },
      { u: 1, p: HOLD_CAN },
    ],
    face: "aah",
    props: (u) => ({ canTilt: Math.max(0, 1 - u * 3) }),
  },
  crush: {
    keys: [
      { u: 0, p: HOLD_CAN },
      { u: 0.4, p: { sF: 62, eF: 110, handF: "grip", torso: 6 } },
      { u: 0.6, p: { sF: 60, eF: 112, handF: "fist", torso: 8 }, ease: "snap" },
      { u: 1, p: { sF: 52, eF: 110, handF: "fist" } },
    ],
    face: "grit",
  },
  toss: {
    keys: [
      { u: 0, p: { sF: 52, eF: 110, handF: "fist" } },
      { u: 0.35, p: { sF: 150, eF: 40, torso: -6, handF: "fist" } },
      {
        u: 0.55,
        p: { sF: 196, eF: 16, torso: -12, handF: "open" },
        ease: "snap",
      },
      { u: 1, p: {} },
    ],
    face: "smirk",
  },
  thumbsUp: {
    keys: [
      { u: 0, p: {} },
      {
        u: 0.3,
        p: {
          torso: 0,
          head: -4,
          sF: 62,
          eF: 112,
          handF: "thumb",
          sB: 12,
          eB: 30,
          fF: [30, 0],
          fB: [-34, 0],
          hip: 90,
        },
        ease: "back",
      },
      {
        u: 1,
        p: {
          torso: 0,
          head: -4,
          sF: 62,
          eF: 112,
          handF: "thumb",
          sB: 12,
          eB: 30,
          fF: [30, 0],
          fB: [-34, 0],
          hip: 90,
        },
      },
    ],
    face: "smirk",
  },
} satisfies Record<string, MoveDef>;

/** Every move name. */
export type MoveName = keyof typeof MOVES;

/** Resolved keys per rig, so a keyframe is solved (IK included) once rather than per frame. */
const resolvedKeys = new WeakMap<Rig, Map<MoveName, Pose[]>>();

function keysFor(name: MoveName, keys: readonly Key[], rig: Rig): Pose[] {
  let byMove = resolvedKeys.get(rig);
  if (!byMove) {
    byMove = new Map();
    resolvedKeys.set(rig, byMove);
  }
  let poses = byMove.get(name);
  if (!poses) {
    poses = keys.map((k) => resolvePose(k.p, rig));
    byMove.set(name, poses);
  }
  return poses;
}

/**
 * The pose of a move at a point in its clip.
 *
 * @param name - The move.
 * @param rig - Whose body.
 * @param u - Clip progress, 0..1.
 * @param t - Seconds into the clip (drives procedural loops).
 * @returns The resolved pose.
 */
export function samplePose(
  name: MoveName,
  rig: Rig,
  u: number,
  t: number,
): Pose {
  const def: MoveDef = MOVES[name];
  if (def.fn) return resolvePose(def.fn(u, t, rig.stance), rig);
  const keys = def.keys ?? [{ u: 0, p: {} }];
  const poses = keysFor(name, keys, rig);
  if (u <= keys[0].u) return poses[0];
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (u <= k.u) {
      const prev = keys[i - 1];
      const local = (u - prev.u) / Math.max(1e-6, k.u - prev.u);
      return lerpPose(poses[i - 1], poses[i], ease(k.ease ?? "inOut", local));
    }
  }
  return poses[poses.length - 1];
}

/**
 * The face a move shows by default.
 *
 * @param name - The move.
 * @returns The expression, or undefined for the fighter's resting face.
 */
export function moveFace(name: MoveName): Expression | undefined {
  const def: MoveDef = MOVES[name];
  return def.face;
}

/**
 * The props a move animates at a point in its clip.
 *
 * @param name - The move.
 * @param u - Clip progress.
 * @returns The props it sets, possibly none.
 */
export function moveProps(name: MoveName, u: number): Partial<Props> {
  const def: MoveDef = MOVES[name];
  return def.props ? def.props(u) : {};
}
