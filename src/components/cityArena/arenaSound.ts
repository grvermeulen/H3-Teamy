"use client";

/**
 * The runtime's per-frame hand-over to the sound layer (immersion spec §6): where the ears are —
 * the local player or the car they drive, facing the 3D camera or north — the local player's
 * own motion for footsteps and skids, and the traffic that can be heard around them.
 */

import type { SelfMotion } from "@/lib/cityArena/audio/selfSounds";
import { listenerAt } from "@/lib/cityArena/audio/spatial";
import type { TrafficSource } from "@/lib/cityArena/audio/trafficVoices";
import type { Scene } from "@/lib/cityArena/render/renderScene";
import { occupiedVehicle } from "@/lib/cityArena/sim/boarding";
import { playerById } from "@/lib/cityArena/sim/players";
import type { ArenaPlayerState, ArenaState } from "@/lib/cityArena/sim/types";
import { forwardSpeed } from "@/lib/cityArena/sim/vehicle";
import type { Runtime } from "./arenaRuntime";

/** The slice of the scene the frame's sound reads. */
export type FrameSoundScene = Pick<
  Scene,
  "players" | "vehicles" | "sirenVehicleIds"
>;

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
 * The cars that can be heard this frame: every car in the scene but the listener's own and the
 * wrecks, with its speed and whether its siren is on.
 *
 * @param scene - The blended scene.
 * @param ownCarId - The car the local player drives, or `null` on foot.
 * @returns The traffic, in scene order.
 */
export function trafficSources(
  scene: Pick<Scene, "vehicles" | "sirenVehicleIds">,
  ownCarId: number | null,
): TrafficSource[] {
  return scene.vehicles
    .filter((vehicle) => !vehicle.wrecked && vehicle.id !== ownCarId)
    .map((vehicle) => ({
      id: vehicle.id,
      x: vehicle.x,
      y: vehicle.y,
      speedMps: Math.hypot(vehicle.velocityX, vehicle.velocityY),
      siren: scene.sirenVehicleIds?.has(vehicle.id) ?? false,
    }));
}

/**
 * Hands this frame to the sound: the listener at the local player's blended position (their
 * car's, when driving) facing the 3D camera's yaw or north, their motion for footsteps, and the
 * traffic around them.
 *
 * @param runtime - The runtime's sound, state and seat.
 * @param scene - The frame about to be drawn, with the blended players.
 * @param yaw3d - The 3D camera's yaw in sim radians, or `null` in 2D.
 * @param dt - Seconds since the previous frame.
 */
export function updateFrameSound(
  runtime: FrameSoundRuntime,
  scene: FrameSoundScene,
  yaw3d: number | null,
  dt: number,
): void {
  const me = playerById(runtime.state, runtime.netplay.playerId);
  if (!me) return;
  const heard = scene.players.find((player) => player.id === me.id) ?? me;
  runtime.sound.setListener(listenerAt(heard.x, heard.y, yaw3d));
  runtime.sound.updateSelf(selfMotion(runtime.state, me));
  runtime.sound.updateWorld({
    dt,
    traffic: trafficSources(scene, me.vehicleId),
  });
}
