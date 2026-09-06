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

/** In-memory Web Audio context that records nodes, connections and resume calls. */
export type FakeAudioContext = AudioContextLike & {
  oscillators: FakeOscillator[];
  gains: FakeGain[];
  resumeCalls: number;
  closeCalls: number;
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
  const context: FakeAudioContext = {
    currentTime: 10,
    destination: node([]),
    oscillators,
    gains,
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
    resume(): void {
      context.resumeCalls += 1;
    },
    close(): void {
      context.closeCalls += 1;
    },
  };
  return { context, factory: () => context };
}
