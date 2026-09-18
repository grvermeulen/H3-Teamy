import { boardingDoor } from "../sim/hijacking";
import type { PedState, VehicleState } from "../sim/types";
import { localToWorld } from "../sim/vehicle";

/** Interpolates a visible driver from the seat through the open door to their safe landing. */
export function boardingPeople(
  peds: PedState[],
  vehicles: VehicleState[],
  tick: number,
  reducedMotion = false,
): PedState[] {
  const result = [...peds];
  for (const vehicle of vehicles) {
    const boarding = vehicle.boarding;
    if (!boarding?.driver) continue;
    const age = tick - boarding.startTick;
    if (age < 13) {
      const point = localToWorld(vehicle, [0.2, boarding.side * 0.3]);
      result.push({
        id: vehicle.id + 10000,
        x: point[0],
        y: point[1],
        facing: vehicle.heading,
        health: 100,
        mode: "walk",
        modeUntilTick: 0,
        rail: null,
        fleeX: 0,
        fleeY: 0,
      });
    } else if (age < 23) {
      const at = result.findIndex((ped) => ped.id === boarding.ejectedId);
      if (at < 0) continue;
      const ped = result[at];
      const door = boardingDoor(vehicle, boarding.side);
      const progress = reducedMotion
        ? 1
        : Math.max(0, Math.min(1, (age - 13) / 9));
      result[at] = {
        ...ped,
        x: door[0] + (ped.x - door[0]) * progress,
        y:
          door[1] +
          (ped.y - door[1]) * progress -
          Math.sin(progress * Math.PI) * 0.5,
        facing: ped.facing + (reducedMotion ? 0 : Math.PI * (1 - progress)),
      };
    }
  }
  return result;
}
