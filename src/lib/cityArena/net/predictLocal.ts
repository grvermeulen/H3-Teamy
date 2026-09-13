import type { stepArena } from "../sim/arena";
import { occupiedVehicle } from "../sim/boarding";
import {
  resolveVehicleAgainstPlayer,
  resolveVehiclePairs,
} from "../sim/collisions";
import { driveStep } from "../sim/driveInput";
import { stepPlayer } from "../sim/player";
import { playerById, replacePlayer } from "../sim/players";
import { forwardSpeed, NO_CONTROLS, stepVehicle } from "../sim/vehicle";

/** Predicts only the controlled player's motion; combat, AI and other bodies remain authoritative. */
export const predictLocal: typeof stepArena = (state, inputs, dt, world) => {
  const command = inputs.entries().next().value;
  const next = { ...state, tick: state.tick + 1, events: [] };
  if (!command) return next;
  const [id, input] = command;
  const player = playerById(state, id);
  if (!player || player.health <= 0) return next;
  const car = occupiedVehicle(state, player);
  if (car) {
    const drive =
      player.boardingTicksLeft > 0
        ? null
        : driveStep(input, car.heading, player.driveSteer, dt);
    let moved = stepVehicle(
      car,
      drive?.controls ?? NO_CONTROLS,
      dt,
      world.collision,
    ).vehicle;
    for (const obstacle of state.vehicles) {
      if (
        obstacle.id === car.id ||
        Math.hypot(obstacle.x - moved.x, obstacle.y - moved.y) > 12
      )
        continue;
      moved = resolveVehiclePairs([moved, obstacle]).vehicles[0]!;
    }
    return replacePlayer(
      {
        ...next,
        vehicles: state.vehicles.map((vehicle) =>
          vehicle.id === car.id ? moved : vehicle,
        ),
      },
      {
        ...player,
        x: moved.x,
        y: moved.y,
        facing: moved.heading,
        speed: Math.abs(forwardSpeed(moved)),
        driveSteer: drive?.steer ?? 0,
        boardingTicksLeft: Math.max(0, player.boardingTicksLeft - 1),
      },
    );
  }
  let moved = { ...player, ...stepPlayer(player, input, dt, world.collision) };
  for (const obstacle of state.vehicles) {
    if (Math.hypot(obstacle.x - moved.x, obstacle.y - moved.y) > 12) continue;
    moved = resolveVehicleAgainstPlayer(obstacle, moved).player;
  }
  return replacePlayer(next, { ...moved, health: player.health });
};
