import type { AudioBufferLike, BufferSourceLike } from "../samples";
import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  OscillatorLike,
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
  resumeCalls: number;
  closeCalls: number;
  createBufferSource(): FakeBufferSource;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  /** The nodes handed out for media elements, in order. */
  mediaSources: AudioNodeLike[];
  createMediaElementSource(element: HTMLMediaElement): AudioNodeLike;
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
  };
}

function node(operations: FakeAudioOperation[]): AudioNodeLike {
  return {
    connect: () => operations.push({ kind: "connect" }),
    disconnect: () => operations.push({ kind: "disconnect" }),
  };
}

/** Creates a fake context and a factory returning it. */
export function createFakeAudioContext(): {
  context: FakeAudioContext;
  factory: () => FakeAudioContext;
} {
  const oscillators: FakeOscillator[] = [];
  const gains: FakeGain[] = [];
  const sources: FakeBufferSource[] = [];
  const mediaSources: AudioNodeLike[] = [];
  const context: FakeAudioContext = {
    currentTime: 10,
    destination: node([]),
    oscillators,
    gains,
    sources,
    mediaSources,
    resumeCalls: 0,
    closeCalls: 0,
    createGain(): FakeGain {
      const operations: FakeAudioOperation[] = [];
      const gain = {
        ...node(operations),
        operations,
        gain: param(operations),
      } as FakeGain;
      gains.push(gain);
      return gain;
    },
    createOscillator(): FakeOscillator {
      const operations: FakeAudioOperation[] = [];
      const oscillator = {
        ...node(operations),
        operations,
        type: "sine",
        frequency: param(operations),
        started: false,
        stopped: false,
        start: () => {
          oscillator.started = true;
          operations.push({ kind: "start" });
        },
        stop: () => {
          oscillator.stopped = true;
          operations.push({ kind: "stop" });
        },
      } as FakeOscillator;
      oscillators.push(oscillator);
      return oscillator;
    },
    createBufferSource(): FakeBufferSource {
      const operations: FakeAudioOperation[] = [];
      const source = {
        ...node(operations),
        operations,
        buffer: null,
        loop: false,
        playbackRate: param(operations),
        started: false,
        stopped: false,
        start: () => {
          source.started = true;
          operations.push({ kind: "start" });
        },
        stop: () => {
          source.stopped = true;
          operations.push({ kind: "stop" });
        },
      } as FakeBufferSource;
      sources.push(source);
      return source;
    },
    createMediaElementSource(): AudioNodeLike {
      const source = node([]);
      mediaSources.push(source);
      return source;
    },
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
