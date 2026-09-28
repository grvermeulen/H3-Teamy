/**
 * The nodes behind one voice (immersion spec §6): a gain at the voice's level, and for a placed
 * voice a low-pass and a stereo panner after it, where the context has them. A context without a
 * panner or a filter still plays the voice — unpanned or unfiltered — rather than not at all.
 */

import type { SpatialMix } from "./spatial";
import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterLike,
  GainNodeLike,
  StereoPannerLike,
} from "./sound";

/** Seconds a moving voice's placement takes to settle (three time constants of the ease). */
const PLACEMENT_RAMP_S = 0.1;
/** Time constants in {@link PLACEMENT_RAMP_S}: after three an exponential ease is 95 % there. */
const RAMP_TIME_CONSTANTS = 3;

/** One voice's nodes, input first. */
export type VoiceChain = {
  /** The voice's gain; the source connects here. */
  input: GainNodeLike;
  /** The distance low-pass, or `null` for an unplaced voice or a context without filters. */
  filter: BiquadFilterLike | null;
  /** The stereo panner, or `null` for an unplaced voice or a context without panners. */
  panner: StereoPannerLike | null;
};

/** Connects the nodes in order, the last into `destination`. */
function connectInOrder(
  nodes: readonly AudioNodeLike[],
  destination: AudioNodeLike,
): void {
  nodes.forEach((node, index) => node.connect(nodes[index + 1] ?? destination));
}

/**
 * Builds the nodes for a voice at `level`, placed by `mix` when one is given.
 *
 * @param context - The audio context.
 * @param destination - Where the voice plays into (the master gain).
 * @param level - The voice's own level, before placement.
 * @param mix - Where it sits, or `null` for a voice heard as if at the listener.
 * @returns The nodes; the caller connects its source to `input`.
 */
export function buildVoiceChain(
  context: AudioContextLike,
  destination: AudioNodeLike,
  level: number,
  mix: SpatialMix | null,
): VoiceChain {
  const now = context.currentTime;
  const input = context.createGain();
  input.gain.setValueAtTime(level * (mix?.gain ?? 1), now);
  if (!mix) {
    input.connect(destination);
    return { input, filter: null, panner: null };
  }
  const filter = context.createBiquadFilter?.() ?? null;
  if (filter) {
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(mix.cutoffHz, now);
  }
  const panner = context.createStereoPanner?.() ?? null;
  panner?.pan.setValueAtTime(mix.pan, now);
  const nodes: AudioNodeLike[] = [input];
  if (filter) nodes.push(filter);
  if (panner) nodes.push(panner);
  connectInOrder(nodes, destination);
  return { input, filter, panner };
}

/** Eases a parameter toward `value`, stepping straight there where the context cannot ease. */
function easeParam(param: AudioParamLike, value: number, now: number): void {
  if (param.setTargetAtTime)
    param.setTargetAtTime(value, now, PLACEMENT_RAMP_S / RAMP_TIME_CONSTANTS);
  else param.setValueAtTime(value, now);
}

/**
 * Moves a voice to a new placement, eased over ≈ {@link PLACEMENT_RAMP_S} so nothing clicks.
 * A voice built without a panner or filter only follows the gain.
 *
 * @param chain - The voice's nodes.
 * @param context - The audio context, for the clock.
 * @param level - The voice's own level, before placement.
 * @param mix - Where it sits now.
 */
export function moveVoiceChain(
  chain: VoiceChain,
  context: AudioContextLike,
  level: number,
  mix: SpatialMix,
): void {
  const now = context.currentTime;
  easeParam(chain.input.gain, level * mix.gain, now);
  if (chain.filter) easeParam(chain.filter.frequency, mix.cutoffHz, now);
  if (chain.panner) easeParam(chain.panner.pan, mix.pan, now);
}

/**
 * Disconnects every node of a voice.
 *
 * @param chain - The voice's nodes.
 */
export function disconnectVoiceChain(chain: VoiceChain): void {
  chain.input.disconnect();
  chain.filter?.disconnect();
  chain.panner?.disconnect();
}
