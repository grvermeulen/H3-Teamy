"use client";

/**
 * The runtime's per-frame hand-over to the sound layer (immersion spec §6): where the ears are —
 * the local player or the car they drive, facing the 3D camera or north — the local player's
 * own motion for footsteps and skids, and the traffic, people and map that can be heard around them.
 */

import type { SoundPoint } from "@/lib/cityArena/audio/eventVoices";
import type { ArenaSound } from "@/lib/cityArena/audio/sound";
import type { SelfMotion } from "@/lib/cityArena/audio/selfSounds";
import { listenerAt } from "@/lib/cityArena/audio/spatial";
import type { SpotLandmark } from "@/lib/cityArena/audio/spotSounds";
import type { TrafficSource } from "@/lib/cityArena/audio/trafficVoices";
import type { Scene } from "@/lib/cityArena/render/renderScene";
import { occupiedVehicle } from "@/lib/cityArena/sim/boarding";
import { playerById } from "@/lib/cityArena/sim/players";
import type { ArenaPlayerState, ArenaState } from "@/lib/cityArena/sim/types";
import { forwardSpeed } from "@/lib/cityArena/sim/vehicle";
import type { MapIndex } from "@/lib/cityArena/world/mapTypes";
import { landmarkCentreMetres } from "@/lib/cityArena/world/zone";
import type { Runtime } from "./arenaRuntime";

/** The slice of the scene the frame's sound reads. */
export type FrameSoundScene = Pick<
  Scene,
  "players" | "vehicles" | "sirenVehicleIds" | "peds"
> & { world: Pick<Scene["world"], "tiles"> };

/** The slice of the runtime the frame's sound touches. */
export type FrameSoundRuntime = Pick<Runtime, "sound" | "state" | "netplay"> & {
  session: Pick<Runtime["session"], "index">;
};

/** The landmarks in metres, per map index: converted once rather than every frame. */
const landmarksByIndex = new WeakMap<MapIndex, SpotLandmark[]>();

/**
 * The map's landmarks as places a spot sound can come from (the church bell), in metres.
 *
 * @param index - The map index.
 * @returns Its landmarks, keyed and in metres; the same array for the same index.
 */
export function spotLandmarks(index: MapIndex): SpotLandmark[] {
  const known = landmarksByIndex.get(index);
  if (known) return known;
  const landmarks = index.landmarks.map((landmark) => {
    const [x, y] = landmarkCentreMetres(landmark);
    return { id: landmark.key, x, y };
  });
  landmarksByIndex.set(index, landmarks);
  return landmarks;
}

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

/** A person slower than this is standing still and makes no footsteps, m/s. */
export const WALKER_MIN_SPEED_MPS = 0.3;

/** Where each person stood last frame, per sound layer: how walkers are told from standers. */
const lastSpots = new WeakMap<ArenaSound, Map<number, SoundPoint>>();

/**
 * The people who moved at walking pace since the last frame. Remembers this frame's spots for the
 * next and forgets the people who have gone.
 *
 * @param peds - This frame's living people, as drawn.
 * @param spots - Where each stood last frame; updated in place.
 * @param dt - Seconds since the last frame.
 * @returns The ones on the move.
 */
export function walkersAmong(
  peds: readonly (SoundPoint & { id: number })[],
  spots: Map<number, SoundPoint>,
  dt: number,
): SoundPoint[] {
  const walkers: SoundPoint[] = [];
  const reach = WALKER_MIN_SPEED_MPS * dt;
  const seen = new Set<number>();
  for (const ped of peds) {
    const last = spots.get(ped.id);
    if (last && dt > 0 && Math.hypot(ped.x - last.x, ped.y - last.y) >= reach)
      walkers.push(ped);
    spots.set(ped.id, { x: ped.x, y: ped.y });
    seen.add(ped.id);
  }
  for (const id of spots.keys()) if (!seen.has(id)) spots.delete(id);
  return walkers;
}

/** The movement memory of one sound layer. */
function spotsOf(sound: ArenaSound): Map<number, SoundPoint> {
  const known = lastSpots.get(sound);
  if (known) return known;
  const spots = new Map<number, SoundPoint>();
  lastSpots.set(sound, spots);
  return spots;
}

/** Nothing to hear: no traffic, people, map or landmarks. */
const SILENT_WORLD = {
  traffic: [],
  peds: [],
  walkers: [],
  tiles: [],
  landmarks: [],
};

/**
 * Hands this frame to the sound: the listener at the local player's blended position (their
 * car's, when driving) facing the 3D camera's yaw or north, their motion for footsteps, and the
 * traffic, people and tiles around them. With no local player there is nobody to hear: the
 * listener is cleared, so the city's loops stop instead of holding their last level.
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
  const { sound } = runtime;
  const me = playerById(runtime.state, runtime.netplay.playerId);
  if (!me) {
    sound.setListener(null);
    sound.updateWorld({ dt, ...SILENT_WORLD });
    return;
  }
  const heard = scene.players.find((player) => player.id === me.id) ?? me;
  const peds = scene.peds.filter((ped) => ped.mode !== "dead");
  sound.setListener(listenerAt(heard.x, heard.y, yaw3d));
  sound.updateSelf(selfMotion(runtime.state, me));
  sound.updateWorld({
    dt,
    traffic: trafficSources(scene, me.vehicleId),
    peds,
    walkers: walkersAmong(peds, spotsOf(sound), dt),
    tiles: scene.world.tiles,
    landmarks: spotLandmarks(runtime.session.index()),
  });
}
