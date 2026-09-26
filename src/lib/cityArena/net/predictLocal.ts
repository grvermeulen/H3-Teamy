import type { stepArena } from "../sim/arena";
import { occupiedVehicle } from "../sim/boarding";
import {
  resolveVehicleAgainstPlayer,
  resolveVehiclePairs,
} from "../sim/collisions";
import { driveStep } from "../sim/driveInput";
import { pruneEffects } from "../sim/effects";
import { stepPlayer } from "../sim/player";
import { landmarkSpeedFactor } from "../sim/landmarkBonuses";
import { playerById, replacePlayer } from "../sim/players";
import { destroyedStructureIds } from "../sim/structures";
import { forwardSpeed, NO_CONTROLS, stepVehicle } from "../sim/vehicle";
import { withoutStructures } from "../world/collisionView";

/** Predicts only the controlled player's motion; combat, AI and other bodies remain authoritative. */
export const predictLocal: typeof stepArena = (state, inputs, dt, world) => {
  const command = inputs.entries().next().value;
  const tick = state.tick + 1;
  // Effects are the client's own (`clientFeedback.ts`); they expire here as the host's do there.
  const effects = pruneEffects(state.effects, tick);
  const next = { ...state, tick, events: [], effects };
  if (!command) return next;
  const [id, input] = command;
  const player = playerById(state, id);
  if (!player || player.health <= 0) return next;
  // Mirrors stepArena's own collision view (spec §3.5): a collapsed building must not block this
  // client's own predicted movement, or the next snapshot's wholesale adoption would just push
  // the player straight back out of rubble the host already lets everyone walk through.
  const collision = withoutStructures(
    world.collision,
    destroyedStructureIds(state),
  );
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
      collision,
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
  let moved = {
    ...player,
    ...stepPlayer(
      player,
      input,
      dt,
      collision,
      landmarkSpeedFactor(player, next.tick),
    ),
  };
  for (const obstacle of state.vehicles) {
    if (Math.hypot(obstacle.x - moved.x, obstacle.y - moved.y) > 12) continue;
    moved = resolveVehicleAgainstPlayer(obstacle, moved).player;
  }
  return replacePlayer(next, { ...moved, health: player.health });
};
