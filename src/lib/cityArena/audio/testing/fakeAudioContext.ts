import type { AudioBufferLike, BufferSourceLike } from "../samples";
import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterLike,
  GainNodeLike,
  OscillatorLike,
  StereoPannerLike,
} from "../sound";

/** Recorded audio parameter operation. */
export type FakeAudioOperation = {
  kind: string;
  value?: number;
  time?: number;
};

/** In-memory oscillator fake used by the synth tests. */
export type FakeOscillator = OscillatorLike & {
  operations: FakeAudioOperation[];
  started: boolean;
  stopped: boolean;
};

/** In-memory gain fake used by the synth tests. */
export type FakeGain = GainNodeLike & { operations: FakeAudioOperation[] };

/** In-memory stereo panner fake used by the placement tests. */
export type FakePanner = StereoPannerLike & {
  operations: FakeAudioOperation[];
};

/** In-memory biquad filter fake used by the placement tests. */
export type FakeFilter = BiquadFilterLike & {
  operations: FakeAudioOperation[];
};

/** In-memory buffer source fake used by the sample tests. */
export type FakeBufferSource = BufferSourceLike & {
  operations: FakeAudioOperation[];
  started: boolean;
  stopped: boolean;
};

/**
 * In-memory Web Audio context that records nodes, connections and resume calls. It decodes any
 * non-empty buffer to a one-second clip and refuses an empty one, so a test can serve a clip
 * that "will not decode" by serving nothing.
 */
export type FakeAudioContext = AudioContextLike & {
  oscillators: FakeOscillator[];
  gains: FakeGain[];
  sources: FakeBufferSource[];
  /** Panners and filters handed out, in order; empty for a context built without them. */
  panners: FakePanner[];
  filters: FakeFilter[];
  resumeCalls: number;
  closeCalls: number;
  createBufferSource(): FakeBufferSource;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  /** The nodes handed out for media elements, in order. */
  mediaSources: AudioNodeLike[];
  createMediaElementSource(element: HTMLMediaElement): AudioNodeLike;
};

/** Options for {@link createFakeAudioContext}. */
export type FakeAudioContextOptions = {
  /** False for a context without stereo panners and biquad filters; default true. */
  spatial?: boolean;
};

function param(operations: FakeAudioOperation[]): AudioParamLike {
  let current = 0;
  return {
    get value(): number {
      return current;
    },
    set value(value: number) {
      current = value;
    },
    setValueAtTime(value: number, time: number): void {
      current = value;
      operations.push({ kind: "set", value, time });
    },
    linearRampToValueAtTime(value: number, time: number): void {
      current = value;
      operations.push({ kind: "ramp", value, time });
    },
    setTargetAtTime(value: number, time: number): void {
      current = value;
      operations.push({ kind: "target", value, time });
    },
  };
}

function node(operations: FakeAudioOperation[]): AudioNodeLike {
  return {
    connect: () => operations.push({ kind: "connect" }),
    disconnect: () => operations.push({ kind: "disconnect" }),
  };
}

/** A source node fake whose `start`/`stop` flip its flags. */
function playable<Extra extends object>(
  extra: Extra,
): Extra & {
  operations: FakeAudioOperation[];
  started: boolean;
  stopped: boolean;
  start(): void;
  stop(): void;
} & AudioNodeLike {
  const operations: FakeAudioOperation[] = [];
  const fake = {
    ...node(operations),
    ...extra,
    operations,
    started: false,
    stopped: false,
    start: () => {
      fake.started = true;
      operations.push({ kind: "start" });
    },
    stop: () => {
      fake.stopped = true;
      operations.push({ kind: "stop" });
    },
  };
  return fake;
}

/** The panner and filter factories, recording into the given lists. */
function spatialNodes(
  panners: FakePanner[],
  filters: FakeFilter[],
): Pick<AudioContextLike, "createStereoPanner" | "createBiquadFilter"> {
  return {
    createStereoPanner(): FakePanner {
      const operations: FakeAudioOperation[] = [];
      const panner = {
        ...node(operations),
        operations,
        pan: param(operations),
      };
      panners.push(panner);
      return panner;
    },
    createBiquadFilter(): FakeFilter {
      const operations: FakeAudioOperation[] = [];
      const filter = {
        ...node(operations),
        operations,
        type: "lowpass",
        frequency: param(operations),
      };
      filters.push(filter);
      return filter;
    },
  };
}

/** The lists a fake context records its nodes into. */
type FakeNodeLists = Pick<
  FakeAudioContext,
  "oscillators" | "gains" | "sources" | "mediaSources"
>;

/** The gain, oscillator, buffer and media-element factories, recording into `lists`. */
function sourceNodes(
  lists: FakeNodeLists,
): Pick<
  FakeAudioContext,
  | "createGain"
  | "createOscillator"
  | "createBufferSource"
  | "createMediaElementSource"
> {
  return {
    createGain(): FakeGain {
      const operations: FakeAudioOperation[] = [];
      const gain = { ...node(operations), operations, gain: param(operations) };
      lists.gains.push(gain);
      return gain;
    },
    createOscillator(): FakeOscillator {
      const oscillator = playable({ type: "sine", frequency: param([]) });
      oscillator.frequency = param(oscillator.operations);
      lists.oscillators.push(oscillator);
      return oscillator;
    },
    createBufferSource(): FakeBufferSource {
      const noBuffer: AudioBufferLike | null = null;
      const source = playable({
        buffer: noBuffer,
        loop: false,
        playbackRate: param([]),
      });
      source.playbackRate = param(source.operations);
      lists.sources.push(source);
      return source;
    },
    createMediaElementSource(): AudioNodeLike {
      const source = node([]);
      lists.mediaSources.push(source);
      return source;
    },
  };
}

/** Creates a fake context and a factory returning it. */
export function createFakeAudioContext(options: FakeAudioContextOptions = {}): {
  context: FakeAudioContext;
  factory: () => FakeAudioContext;
} {
  const lists: FakeNodeLists = {
    oscillators: [],
    gains: [],
    sources: [],
    mediaSources: [],
  };
  const panners: FakePanner[] = [];
  const filters: FakeFilter[] = [];
  const context: FakeAudioContext = {
    ...lists,
    ...sourceNodes(lists),
    ...(options.spatial === false ? {} : spatialNodes(panners, filters)),
    currentTime: 10,
    destination: node([]),
    panners,
    filters,
    resumeCalls: 0,
    closeCalls: 0,
    decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
      return data.byteLength === 0
        ? Promise.reject(new Error("undecodable"))
        : Promise.resolve({ duration: 1 });
    },
    resume(): void {
      context.resumeCalls += 1;
    },
    close(): void {
      context.closeCalls += 1;
    },
  };
  return { context, factory: () => context };
}
