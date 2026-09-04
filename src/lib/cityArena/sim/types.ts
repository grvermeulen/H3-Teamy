import type { ZoneKey } from "../world/mapTypes";

/** Device-agnostic movement input: a vector with length ≤ 1 (x east, y south). */
export type WorldInput = { move: [number, number] };

/** The local player on foot; `facing` in radians, `speed` in m/s. */
export type PlayerState = {
  x: number;
  y: number;
  facing: number;
  speed: number;
};

/** Single-player free-roam session state. */
export type FreeRoamState = {
  tick: number;
  player: PlayerState;
  zoneKey: ZoneKey | null;
};
