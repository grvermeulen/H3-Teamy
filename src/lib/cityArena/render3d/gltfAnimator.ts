/**
 * Plays a {@link ClipMix} on one glTF character's `AnimationMixer`, in layers: the legs follow the
 * gait (idle, walk, run); the upper body follows the gait too unless a raised gun or a one-off clip
 * (shot, punch, swing) takes it over; the death overrides everything and holds its last frame.
 * Weights ease toward their targets (a crossfade of about {@link CROSSFADE_S}); the walk and run
 * share one gait phase so the feet stay in step through the blend. Nothing is allocated per
 * frame.
 */
import {
  AnimationMixer,
  LoopOnce,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from "three";
import type { ClipMix, GaitRole } from "./characterAnimation";
import type { RigAsset } from "./characterAssets";

/** Roughly how long a crossfade takes, seconds. */
export const CROSSFADE_S = 0.2;
/** The one-off clips a fresh recoil starts. */
type OnceRole = "gunShoot" | "punch" | "swing";
const ONCE_ROLES: readonly OnceRole[] = ["gunShoot", "punch", "swing"];
/** The gait clips, in {@link ClipMix.base} order. */
const GAIT: readonly GaitRole[] = ["idle", "walk", "run"];
/** Gait clips whose time the shared phase sets (the idle runs on its own clock). */
const PHASED = [false, true, true] as const;

/** The eased weights of every layer. */
type Weights = {
  base: [number, number, number];
  gun: number;
  once: number;
  death: number;
};

/** A character's layered animation. */
export type GltfAnimator = {
  /**
   * Reads this frame's mix: starts a death or a one-off clip it asks for. Cheap; call it every
   * frame, even when {@link GltfAnimator.advance} is skipped.
   */
  observe(mix: ClipMix): void;
  /** Eases the weights toward the last observed mix and advances the clips by `dt` seconds. */
  advance(dt: number): void;
  /** Back to standing idle, nothing playing once (for a pooled character's next owner). */
  reset(): void;
  /** True while the death plays or holds. */
  dying(): boolean;
  /** Stops everything and forgets the character's bindings. */
  dispose(): void;
};

/** The actions of one character. */
type Actions = {
  lower: AnimationAction[];
  upper: AnimationAction[];
  gun: AnimationAction;
  once: Record<OnceRole, AnimationAction>;
  death: AnimationAction;
};

/** An action that plays once and stops (or, for the death, holds its last frame). */
function onceAction(
  mixer: AnimationMixer,
  clip: AnimationClip,
  hold: boolean,
): AnimationAction {
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = hold;
  return action;
}

/** Every action of a rig on a character, the gait playing and everything else silent. */
function createActions(mixer: AnimationMixer, rig: RigAsset): Actions {
  const gaitAction = (
    clip: AnimationClip,
    phased: boolean,
  ): AnimationAction => {
    const action = mixer.clipAction(clip);
    if (phased) action.timeScale = 0;
    return action.play();
  };
  const once = {} as Record<OnceRole, AnimationAction>;
  for (const role of ONCE_ROLES)
    once[role] = onceAction(mixer, rig.upper[role], false);
  return {
    lower: GAIT.map((role, index) =>
      gaitAction(rig.lower[role], PHASED[index]),
    ),
    upper: GAIT.map((role, index) =>
      gaitAction(rig.upper[role], PHASED[index]),
    ),
    gun: mixer.clipAction(rig.upper.gunIdle).play(),
    once,
    death: onceAction(mixer, rig.clips.death, true),
  };
}

/** Moves `from` toward `to` by `share` of the gap. */
function ease(from: number, to: number, share: number): number {
  return from + (to - from) * share;
}

/** Writes every action's weight from the eased weights. */
function applyWeights(
  actions: Actions,
  weights: Weights,
  running: OnceRole | null,
): void {
  const live = 1 - weights.death;
  const overlay = Math.min(1, weights.gun + weights.once);
  for (let index = 0; index < GAIT.length; index += 1) {
    const base = weights.base[index] * live;
    actions.lower[index].setEffectiveWeight(base);
    actions.upper[index].setEffectiveWeight(base * (1 - overlay));
  }
  actions.gun.setEffectiveWeight(weights.gun * live);
  for (const role of ONCE_ROLES)
    actions.once[role].setEffectiveWeight(
      role === running ? weights.once * live : 0,
    );
  actions.death.setEffectiveWeight(weights.death);
}

/** Puts the phased gait clips at the shared phase. */
function applyPhase(actions: Actions, phase: number): void {
  for (let index = 0; index < GAIT.length; index += 1) {
    if (!PHASED[index]) continue;
    const duration = actions.lower[index].getClip().duration;
    actions.lower[index].time = phase * duration;
    actions.upper[index].time = phase * duration;
  }
}

/** One character's animation state. */
type AnimatorState = {
  mixer: AnimationMixer;
  actions: Actions;
  weights: Weights;
  /** What the last observed mix asked for. */
  target: {
    base: [number, number, number];
    gun: number;
    cyclesPerSecond: number;
  };
  phase: number;
  /** The one-off clip playing, if any. */
  running: OnceRole | null;
  dying: boolean;
  /** Nothing observed since creation or reset. */
  fresh: boolean;
};

/** Starts the death; a character first seen dead lies down at once instead of falling. */
function startDeath(state: AnimatorState): void {
  state.dying = true;
  const { death } = state.actions;
  death.reset().play();
  if (!state.fresh) return;
  death.time = death.getClip().duration;
  state.weights.death = 1;
}

/** Stands a revived character straight back up (a respawn moves it anyway). */
function endDeath(state: AnimatorState): void {
  state.dying = false;
  state.actions.death.stop();
  state.weights.death = 0;
}

/** Reads a mix: gait targets, and a death or one-off clip to start. */
function observeMix(state: AnimatorState, mix: ClipMix): void {
  for (let index = 0; index < GAIT.length; index += 1)
    state.target.base[index] = mix.base[index].weight;
  state.target.gun = mix.upper ? mix.upper.weight : 0;
  state.target.cyclesPerSecond = mix.cyclesPerSecond;
  if (mix.once === "death") {
    if (!state.dying) startDeath(state);
  } else if (state.dying) endDeath(state);
  if (mix.once && mix.once !== "death" && !state.dying) {
    state.running = mix.once as OnceRole;
    state.actions.once[state.running].reset().play();
  }
  state.fresh = false;
}

/** Eases the weights, moves the gait phase and advances the mixer. */
function advanceState(state: AnimatorState, dt: number): void {
  const { actions, weights, target } = state;
  const share = Math.min(1, dt / CROSSFADE_S);
  if (state.running && !actions.once[state.running].isRunning())
    state.running = null;
  for (let index = 0; index < GAIT.length; index += 1)
    weights.base[index] = ease(weights.base[index], target.base[index], share);
  weights.gun = ease(weights.gun, state.running ? 0 : target.gun, share);
  weights.once = ease(weights.once, state.running ? 1 : 0, share);
  weights.death = ease(weights.death, state.dying ? 1 : 0, share);
  state.phase = (state.phase + dt * target.cyclesPerSecond) % 1;
  applyPhase(actions, state.phase);
  applyWeights(actions, weights, state.running);
  state.mixer.update(dt);
}

/** Back to standing idle with nothing playing once. */
function resetState(state: AnimatorState): void {
  const { actions, weights } = state;
  state.mixer.stopAllAction();
  for (let index = 0; index < GAIT.length; index += 1) {
    actions.lower[index].play();
    actions.upper[index].play();
  }
  actions.gun.play();
  weights.base[0] = 1;
  weights.base[1] = weights.base[2] = 0;
  weights.gun = weights.once = weights.death = 0;
  state.phase = 0;
  state.running = null;
  state.dying = false;
  state.fresh = true;
}

/**
 * Layers a rig's clips on a character.
 *
 * @param root - The character's cloned scene; the clips bind to its bones by name.
 * @param rig - The rig's clips.
 * @returns The animator.
 */
export function createGltfAnimator(
  root: Object3D,
  rig: RigAsset,
): GltfAnimator {
  const mixer = new AnimationMixer(root);
  const state: AnimatorState = {
    mixer,
    actions: createActions(mixer, rig),
    weights: { base: [1, 0, 0], gun: 0, once: 0, death: 0 },
    target: { base: [1, 0, 0], gun: 0, cyclesPerSecond: 0 },
    phase: 0,
    running: null,
    dying: false,
    fresh: true,
  };
  return {
    observe: (mix) => observeMix(state, mix),
    advance: (dt) => advanceState(state, dt),
    reset: () => resetState(state),
    dying: () => state.dying,
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
  };
}
