import * as Sentry from "@sentry/nextjs";
import type { ArenaState } from "../sim/types";
import type { ZoneKey } from "../world/mapTypes";
import { smoothFrame } from "../render/smoothing";
import { INTERPOLATION_DELAY_MS } from "./interpolate";
import { applySnapshot } from "./snapshotApply";
import { createSnapshotDecoder } from "./snapshotDelta";
import { decodeSnapshot, type SnapshotView } from "./snapshotWire";
import type { RealtimeTransport } from "./transport";
import { isSnapshot, recordInvalidWireMessage } from "./wireValidation";

/** Empty receiver state; no map, sprite, simulation or player is constructed. */
export function emptyObserverState(zone: ZoneKey): ArenaState {
  return {
    tick: 0,
    seed: 0,
    nextId: 1,
    players: [],
    vehicles: [],
    bullets: [],
    effects: [],
    zoneKey: zone,
    peds: [],
    cops: [],
    pickups: [],
    traffic: [],
    events: [],
    activeZoneKey: zone,
    zoneEnforced: false,
  };
}

/** Host-only receiver used by controller phones and anonymous screens. */
export type ArenaObserver = {
  state(): ArenaState;
  snapshot(): SnapshotView | null;
  view(now: number): ArenaState;
  stop(): void;
};

/** Validates, expands and interpolates one epoch without prediction or input publication. */
export function createArenaObserver(options: {
  transport: RealtimeTransport;
  stateChannel: string;
  hostClientId: string;
  zone: ZoneKey;
  initialState?: ArenaState;
  onSnapshot?: (state: ArenaState, view: SnapshotView) => void;
}): ArenaObserver {
  const expand = createSnapshotDecoder();
  let state = options.initialState ?? emptyObserverState(options.zone);
  let snapshot: SnapshotView | null = null;
  const frames: { state: ArenaState; time: number }[] = [];
  const stop = options.transport
    .channel(options.stateChannel)
    .subscribe("state", (message) => {
      if (message.clientId !== options.hostClientId) return;
      if (!isSnapshot(message.data)) {
        recordInvalidWireMessage("snapshot");
        return;
      }
      try {
        const full = expand(message.data);
        if (!full) return;
        snapshot = decodeSnapshot(full);
        state = applySnapshot(state, snapshot);
        frames.push({ state, time: full.s });
        if (frames.length > 6) frames.shift();
        options.onSnapshot?.(state, snapshot);
      } catch (error: unknown) {
        Sentry.captureException(error, {
          tags: { area: "arena", kind: "observer-snapshot" },
        });
      }
    });
  return {
    state: () => state,
    snapshot: () => snapshot,
    view(now) {
      const at = now - INTERPOLATION_DELAY_MS;
      const nextIndex = frames.findIndex((frame) => frame.time >= at);
      const current = frames[nextIndex < 0 ? frames.length - 1 : nextIndex];
      if (!current) return state;
      const previous =
        frames[
          Math.max(0, (nextIndex < 0 ? frames.length - 1 : nextIndex) - 1)
        ];
      if (!previous || previous === current) return current.state;
      const alpha = Math.max(
        0,
        Math.min(
          1,
          (at - previous.time) / Math.max(1, current.time - previous.time),
        ),
      );
      return {
        ...current.state,
        ...smoothFrame(previous.state, current.state, alpha),
      };
    },
    stop,
  };
}
