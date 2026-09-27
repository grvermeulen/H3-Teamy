"use client";

/**
 * The runtime's per-frame hand-over to the sound layer (immersion spec §6): where the ears are —
 * the local player or the car they drive, facing the 3D camera or north — and the local player's
 * own motion for footsteps and skids.
 */

import type { SelfMotion } from "@/lib/cityArena/audio/selfSounds";
import { listenerAt } from "@/lib/cityArena/audio/spatial";
import type { Scene } from "@/lib/cityArena/render/renderScene";
import { occupiedVehicle } from "@/lib/cityArena/sim/boarding";
import { playerById } from "@/lib/cityArena/sim/players";
import type { ArenaPlayerState, ArenaState } from "@/lib/cityArena/sim/types";
import { forwardSpeed } from "@/lib/cityArena/sim/vehicle";
import type { Runtime } from "./arenaRuntime";

/** The slice of the runtime the frame's sound touches. */
export type FrameSoundRuntime = Pick<Runtime, "sound" | "state" | "netplay">;

/**
 * The local player's motion this tick, as the footsteps and the skid detector need it.
 *
 * @param state - The latest state.
 * @param player - The local player in it.
 * @returns Their motion: on foot or in a car, and how fast.
 */
export function selfMotion(
  state: ArenaState,
  player: ArenaPlayerState,
): SelfMotion {
  const alive = player.diedAtTick === null;
  const car = occupiedVehicle(state, player);
  return {
    tick: state.tick,
    onFoot: alive && car === null,
    speedMps: player.speed,
    car:
      alive && car && !car.wrecked
        ? { forwardMps: forwardSpeed(car), heading: car.heading }
        : null,
  };
}

/**
 * Hands this frame to the sound: the listener at the local player's blended position (their
 * car's, when driving) facing the 3D camera's yaw or north, and their motion for footsteps.
 *
 * @param runtime - The runtime's sound, state and seat.
 * @param scene - The frame about to be drawn, with the blended players.
 * @param yaw3d - The 3D camera's yaw in sim radians, or `null` in 2D.
 */
export function updateFrameSound(
  runtime: FrameSoundRuntime,
  scene: Pick<Scene, "players">,
  yaw3d: number | null,
): void {
  const me = playerById(runtime.state, runtime.netplay.playerId);
  if (!me) return;
  const heard = scene.players.find((player) => player.id === me.id) ?? me;
  runtime.sound.setListener(listenerAt(heard.x, heard.y, yaw3d));
  runtime.sound.updateSelf(selfMotion(runtime.state, me));
}
