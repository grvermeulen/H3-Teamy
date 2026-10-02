import { distance } from "../mapBuild/geometry";
import { planNavigation } from "../world/navigation";
import { moveToward, pathTo } from "../world/pathFollow";
import { firstBuildingHit } from "../world/raycast";
import type { Point } from "../world/projection";
import type { ArenaWorld } from "../sim/arenaWorld";
import { createShots, MAX_BULLETS } from "../sim/bullets";
import { MAX_PEDS, MAX_VEHICLES, MAX_TRAFFIC } from "../sim/limits";
import { replacePlayer } from "../sim/players";
import { addHeat } from "../sim/wanted";
import { createVehicle, healthMaxOf, localToWorld } from "../sim/vehicle";
import { WEAPONS } from "../sim/weapons";
import type { ArenaState, PedState } from "../sim/types";
import { missionById } from "./catalog";
import {
  missionPrimitives,
  missionScenario,
  type MissionActorSpec,
} from "./scenarios";
import { missionAnchor, missionHeading, missionTargets } from "./targets";
import type { MissionActorBinding, MissionProfile } from "./types";

/** IDs held by active contracts; population recycling must leave them in the world. */
export function missionEntityIds(state: ArenaState): Set<number> {
  return new Set(
    state.players.flatMap((player) =>
      Object.values(player.mission?.actors ?? {}).map((actor) => actor.id),
    ),
  );
}

/** Bound mission actors, used to classify destructible props and fictional adversaries. */
export function boundMissionActors(
  state: Pick<ArenaState, "players">,
): { spec: MissionActorSpec; binding: MissionActorBinding }[] {
  return state.players.flatMap((player) => {
    const definition =
      player.mission?.run && missionById(player.mission.run.definitionId);
    if (!definition) return [];
    return missionScenario(definition).actors.flatMap((spec) => {
      const binding = player.mission?.actors?.[spec.alias];
      return binding ? [{ spec, binding }] : [];
    });
  });
}

/** Fictional armed actors do not count as civilian casualties for a clean-contract bonus. */
export function missionAdversaryIds(state: ArenaState): Set<number> {
  return new Set(
    boundMissionActors(state)
      .filter(
        ({ spec }) =>
          spec.behavior === "hostile" ||
          spec.armedFromStage !== undefined ||
          spec.alias === "bewaker",
      )
      .map(({ binding }) => binding.id),
  );
}

/** IDs seated as passengers, excluded from pedestrian drawing and road collisions. */
export function missionPassengerIds(
  state: Pick<ArenaState, "players">,
): Set<number> {
  return new Set(
    state.players.flatMap((player) =>
      Object.values(player.mission?.actors ?? {})
        .filter((actor) => actor.vehicleId !== null)
        .map((actor) => actor.id),
    ),
  );
}

/** Removes temporary actors, retaining any vehicle a player currently drives. */
export function clearMissionActors(
  state: ArenaState,
  profile: MissionProfile,
): ArenaState {
  const ids = new Set(
    Object.values(profile.actors ?? {}).map((actor) => actor.id),
  );
  return {
    ...state,
    peds: state.peds.filter((ped) => !ids.has(ped.id)),
    vehicles: state.vehicles.filter(
      (vehicle) =>
        !ids.has(vehicle.id) ||
        state.players.some((player) => player.vehicleId === vehicle.id),
    ),
    traffic: state.traffic.filter((driver) => !ids.has(driver.vehicleId)),
  };
}

function actorRoute(
  state: ArenaState,
  world: ArenaWorld,
  spec: MissionActorSpec,
  binding: MissionActorBinding,
  from: Point,
  definitionId: string,
): ArenaState {
  if (!binding.driving) return state;
  const occupied = state.players.some(
    (player) => player.vehicleId === binding.id,
  );
  const vehicle = state.vehicles.find((entry) => entry.id === binding.id);
  if (occupied || vehicle?.boarding?.ejectedId != null) {
    binding.driving = false;
    return {
      ...state,
      traffic: state.traffic.filter((entry) => entry.vehicleId !== binding.id),
    };
  }
  if (vehicle?.wrecked) return state;
  const destination = missionAnchor(
    `${definitionId}:${spec.route?.[binding.routeIndex % (spec.route?.length ?? 1)]}`,
  );
  if (!destination) return state;
  if (distance(from, destination) < 12)
    binding.routeIndex = (binding.routeIndex + 1) % (spec.route?.length ?? 1);
  const old = state.traffic.find((driver) => driver.vehicleId === binding.id);
  if (old && state.tick < old.repathTick && old.path.length > 1) return state;
  const target = missionAnchor(
    `${definitionId}:${spec.route?.[binding.routeIndex]}`,
  )!;
  const path = pathTo(world.graph, from, target, 100);
  if (!path) return state;
  const driver = {
    vehicleId: binding.id,
    role: "traffic" as const,
    cruiseMps: 4,
    fromNode: path[0] ?? null,
    path: path.slice(1),
    repathTick: state.tick + 60,
  };
  return {
    ...state,
    traffic: [
      ...state.traffic.filter((entry) => entry.vehicleId !== binding.id),
      driver,
    ],
  };
}

/** Spawns only actors needed so far and applies each scripted stage pressure exactly once. */
export function ensureMissionActors(
  state: ArenaState,
  world: ArenaWorld,
): ArenaState {
  let next = state;
  for (const original of state.players) {
    const profile = original.mission;
    const run = profile?.run;
    const definition = run && missionById(run.definitionId);
    if (!profile || !run || !definition) continue;
    if (run.status !== "active") {
      if (profile.actors && Object.keys(profile.actors).length) {
        next = clearMissionActors(next, profile);
        next = replacePlayer(next, {
          ...original,
          mission: { ...profile, actors: {} },
        });
      }
      continue;
    }
    const scenario = missionScenario(definition);
    const actors = structuredClone(profile.actors ?? {});
    for (const spec of scenario.actors) {
      if (
        run.stage < spec.fromStage ||
        (spec.untilStage !== undefined && run.stage >= spec.untilStage)
      )
        continue;
      const position = missionAnchor(`${definition.id}:${spec.alias}`);
      if (!position) continue;
      if (!actors[spec.alias]) {
        if (spec.kind === "vehicle" && next.vehicles.length >= MAX_VEHICLES) {
          const protectedIds = missionEntityIds(next);
          const occupied = new Set(
            next.players.map((player) => player.vehicleId),
          );
          const disposable = next.vehicles
            .filter(
              (vehicle) =>
                !protectedIds.has(vehicle.id) &&
                !occupied.has(vehicle.id) &&
                !vehicle.boarding,
            )
            .sort(
              (a, b) =>
                distance([b.x, b.y], [original.x, original.y]) -
                distance([a.x, a.y], [original.x, original.y]),
            )[0];
          if (!disposable) continue;
          next = {
            ...next,
            vehicles: next.vehicles.filter(
              (vehicle) => vehicle.id !== disposable.id,
            ),
            traffic: next.traffic.filter(
              (driver) => driver.vehicleId !== disposable.id,
            ),
          };
        }
        if (spec.kind !== "vehicle" && next.peds.length >= MAX_PEDS) {
          const protectedIds = missionEntityIds(next);
          const disposable = next.peds
            .filter((ped) => !protectedIds.has(ped.id))
            .sort(
              (a, b) =>
                distance([b.x, b.y], [original.x, original.y]) -
                distance([a.x, a.y], [original.x, original.y]),
            )[0];
          if (!disposable) continue;
          next = {
            ...next,
            peds: next.peds.filter((ped) => ped.id !== disposable.id),
          };
        }
        const id = next.nextId;
        actors[spec.alias] = {
          id,
          routeIndex: 0,
          path: [],
          nextShot: next.tick + 90,
          vehicleId: null,
          driving: spec.kind === "vehicle" && spec.behavior === "route",
        };
        next = { ...next, nextId: id + 1 };
        if (spec.kind === "vehicle")
          next = {
            ...next,
            vehicles: [
              ...next.vehicles,
              createVehicle(
                id,
                spec.vehicleKind ?? "sedan",
                position,
                missionHeading(`${definition.id}:${spec.alias}`),
                id % 8,
              ),
            ],
          };
        else
          next = {
            ...next,
            peds: [
              ...next.peds,
              {
                id,
                x: position[0],
                y: position[1],
                facing: 0,
                health: 100,
                mode: "walk",
                modeUntilTick: 0,
                rail: null,
                fleeX: 0,
                fleeY: 0,
              },
            ],
          };
      }
      const actor = actors[spec.alias];
      const vehicle = next.vehicles.find((entry) => entry.id === actor.id);
      if (spec.kind === "vehicle" && vehicle)
        next = actorRoute(
          next,
          world,
          spec,
          actor,
          [vehicle.x, vehicle.y],
          definition.id,
        );
    }
    let player = next.players.find((entry) => entry.id === original.id)!;
    if (
      profile.appliedStage !== run.stage &&
      scenario.heatStages.includes(run.stage)
    )
      player = addHeat(player, 40, next.tick);
    next = replacePlayer(next, {
      ...player,
      mission: {
        ...profile,
        actors,
        appliedStage: run.stage,
        cargoIntegrity: profile.cargoIntegrity ?? 100,
      },
    });
  }
  if (next.traffic.length > MAX_TRAFFIC) {
    const protectedIds = missionEntityIds(next);
    next = {
      ...next,
      traffic: [...next.traffic]
        .sort(
          (a, b) =>
            Number(protectedIds.has(b.vehicleId)) -
            Number(protectedIds.has(a.vehicleId)),
        )
        .slice(0, MAX_TRAFFIC),
    };
  }
  return next;
}

function walking(
  ped: PedState,
  destination: Point,
  binding: MissionActorBinding,
  world: ArenaWorld,
  tick: number,
  speed: number,
): PedState {
  const at: Point = [ped.x, ped.y];
  if (distance(at, destination) < 1) return ped;
  if (binding.path.length === 0 || tick % 30 === 0) {
    const route = planNavigation(world.graph, at, destination, false);
    binding.path =
      route.status === "unreachable" ? [] : [...route.points, destination];
  }
  while (binding.path.length && distance(at, binding.path[0]) < 1)
    binding.path.shift();
  const target = binding.path[0];
  if (!target) return ped;
  const point = world.collision.resolveCircle(
    moveToward(at, target, speed / 30),
    0.45,
  );
  return {
    ...ped,
    x: point[0],
    y: point[1],
    facing: Math.atan2(point[1] - ped.y, point[0] - ped.x),
  };
}

/** Mission people use authored routes, passenger boarding and bounded hostile fire. */
export function stepMissionActors(
  state: ArenaState,
  world: ArenaWorld,
  random: () => number,
): ArenaState {
  let next = state;
  for (const original of state.players) {
    const profile = original.mission;
    const run = profile?.run;
    const definition = run && missionById(run.definitionId);
    if (!profile || !run || !definition || run.status !== "active") continue;
    const scenario = missionScenario(definition);
    const actors = structuredClone(profile.actors ?? {});
    const targets = missionTargets(definition, next, profile);
    for (const spec of scenario.actors) {
      const binding = actors[spec.alias];
      if (
        !binding ||
        spec.kind === "vehicle" ||
        (spec.untilStage !== undefined && run.stage >= spec.untilStage)
      )
        continue;
      let ped = next.peds.find((entry) => entry.id === binding.id);
      if (!ped || ped.health === 0) continue;
      if (spec.behavior === "escort") {
        const objective = missionPrimitives(definition).find(
          (entry) =>
            entry.stage === run.stage &&
            entry.objective.kind === "escort" &&
            entry.objective.target === spec.alias,
        )?.objective;
        const destination =
          objective?.kind === "escort"
            ? targets[objective.destination]?.position
            : undefined;
        const car = next.vehicles.find(
          (entry) => entry.id === original.vehicleId,
        );
        if (binding.vehicleId !== null) {
          const ride = next.vehicles.find(
            (entry) => entry.id === binding.vehicleId,
          );
          if (!ride || ride.wrecked)
            ped = {
              ...ped,
              health: 0,
              mode: "dead",
              modeUntilTick: state.tick + 240,
            };
          else if (
            original.vehicleId !== ride.id ||
            (destination &&
              distance([ride.x, ride.y], destination) < 6 &&
              original.speed < 0.5)
          ) {
            const point = world.collision.resolveCircle(
              localToWorld(ride, [0, 2.2]),
              0.45,
            );
            binding.vehicleId = null;
            ped = { ...ped, x: point[0], y: point[1] };
          } else ped = { ...ped, x: ride.x, y: ride.y };
        } else if (
          car &&
          !["tank", "tractor", "sport"].includes(car.kind) &&
          original.speed < 0.5 &&
          distance([ped.x, ped.y], [car.x, car.y]) <= 4 &&
          !(destination && distance([ped.x, ped.y], destination) <= 6)
        ) {
          binding.vehicleId = car.id;
          ped = { ...ped, x: car.x, y: car.y };
        } else if (distance([ped.x, ped.y], [original.x, original.y]) < 35)
          ped = walking(
            ped,
            destination && distance([original.x, original.y], destination) < 8
              ? destination
              : [original.x, original.y],
            binding,
            world,
            state.tick,
            2.6,
          );
      } else if (
        spec.behavior === "route" &&
        run.stage >= (spec.behaviorFromStage ?? 0) &&
        !(spec.armedFromStage !== undefined && run.stage >= spec.armedFromStage)
      ) {
        const target = targets[spec.route?.[binding.routeIndex] ?? ""];
        if (target) {
          ped = walking(ped, target.position, binding, world, state.tick, 2);
          if (distance([ped.x, ped.y], target.position) < 3)
            binding.routeIndex =
              spec.alias === "bewaker"
                ? (binding.routeIndex + 1) % (spec.route?.length ?? 1)
                : Math.min(
                    binding.routeIndex + 1,
                    (spec.route?.length ?? 1) - 1,
                  );
        }
      } else if (
        spec.behavior === "hostile" ||
        (spec.armedFromStage !== undefined && run.stage >= spec.armedFromStage)
      ) {
        const defended = spec.protects ? targets[spec.protects] : undefined;
        const target: Point = defended?.position ?? [original.x, original.y];
        if (distance([ped.x, ped.y], target) > 12)
          ped = walking(ped, target, binding, world, state.tick, 2.4);
        if (
          state.tick >= binding.nextShot &&
          distance([ped.x, ped.y], target) < 35 &&
          next.bullets.length < MAX_BULLETS
        ) {
          const angle = Math.atan2(target[1] - ped.y, target[0] - ped.x);
          const shots = createShots(
            { ...WEAPONS.pistol, damage: 8 },
            "pistol",
            [ped.x, ped.y],
            angle,
            { firstId: next.nextId, ownerId: ped.id, ignoreVehicleId: null },
            random,
          );
          binding.nextShot = state.tick + 60;
          next = {
            ...next,
            bullets: [...next.bullets, ...shots],
            nextId: next.nextId + shots.length,
            events: [
              ...next.events,
              {
                kind: "shot",
                ownerId: ped.id,
                weapon: "pistol",
                x: ped.x,
                y: ped.y,
              },
            ],
          };
        }
      }
      next = {
        ...next,
        peds: next.peds.map((entry) => (entry.id === ped.id ? ped : entry)),
      };
    }
    let integrity = profile.cargoIntegrity ?? 100;
    if (scenario.coolingPerSecond)
      integrity = Math.max(0, integrity - scenario.coolingPerSecond / 30);
    const impact = state.events
      .filter(
        (event) =>
          event.kind === "impact" &&
          (event.vehicleId === original.vehicleId ||
            event.otherVehicleId === original.vehicleId),
      )
      .reduce(
        (max, event) =>
          event.kind === "impact" ? Math.max(max, event.impactSpeed) : max,
        0,
      );
    if (impact > 5) integrity = Math.max(0, integrity - (impact - 5) * 2);
    let player = next.players.find((entry) => entry.id === original.id)!;
    let detected = run.detected;
    const guard =
      actors.bewaker && next.peds.find((ped) => ped.id === actors.bewaker.id);
    if (definition.id === "M21" && guard && guard.health > 0 && !detected) {
      const dx = player.x - guard.x,
        dy = player.y - guard.y;
      const gap = Math.hypot(dx, dy);
      const inView =
        gap < 22 &&
        (gap < 2 ||
          (dx * Math.cos(guard.facing) + dy * Math.sin(guard.facing)) / gap >
            0.4);
      if (
        inView &&
        !firstBuildingHit(
          world.collision,
          [guard.x, guard.y],
          [player.x, player.y],
        )
      ) {
        detected = true;
        player = addHeat(player, 80, state.tick);
      }
    }
    next = replacePlayer(next, {
      ...player,
      mission: {
        ...profile,
        run: { ...run, detected },
        actors,
        cargoIntegrity: integrity,
      },
    });
  }
  return next;
}

/** Derives destruction and quality from actual actors instead of client reward claims. */
export function missionCondition(
  state: ArenaState,
  profile: MissionProfile,
): { integrity: number; failure: string | null } {
  const run = profile.run;
  const definition = run && missionById(run.definitionId);
  if (!run || !definition) return { integrity: 100, failure: null };
  const scenario = missionScenario(definition);
  let integrity = profile.cargoIntegrity ?? 100;
  const targets = missionTargets(definition, state, profile);
  for (const spec of scenario.actors) {
    const binding = profile.actors?.[spec.alias];
    if (
      !binding ||
      spec.behavior === "hostile" ||
      (spec.untilStage !== undefined && run.stage >= spec.untilStage)
    )
      continue;
    const entity =
      spec.kind === "vehicle"
        ? state.vehicles.find((entry) => entry.id === binding.id)
        : state.peds.find((entry) => entry.id === binding.id);
    const remaining = missionPrimitives(definition).filter(
      (entry) => entry.stage >= run.stage,
    );
    const needed = remaining.some(
      ({ objective }) =>
        ("target" in objective &&
          objective.target === spec.alias &&
          objective.kind !== "eliminate") ||
        ("vehicle" in objective && objective.vehicle === spec.alias),
    );
    if (needed && (!entity || entity.health <= 0))
      return {
        integrity: 0,
        failure: "Een noodzakelijk persoon of voertuig is uitgeschakeld.",
      };
    if (
      entity &&
      needed &&
      (spec.kind === "vehicle" ||
        spec.behavior === "escort" ||
        spec.kind === "prop")
    )
      integrity = Math.min(
        integrity,
        (entity.health /
          (spec.kind === "vehicle"
            ? healthMaxOf(spec.vehicleKind ?? "sedan")
            : 100)) *
          100,
      );
  }
  if (
    scenario.minimumVehicleIntegrity &&
    integrity < scenario.minimumVehicleIntegrity
  )
    return { integrity, failure: "Het doelvoertuig is te zwaar beschadigd." };
  if (scenario.coolingPerSecond && integrity <= 0)
    return { integrity, failure: "De onderzoeksmonsters zijn bedorven." };
  if (
    ["M02", "M06"].includes(definition.id) &&
    (profile.cargoIntegrity ?? 100) <= 0
  )
    return { integrity, failure: "De lading is verloren gegaan." };
  if (
    definition.id === "M11" &&
    targets.dubbelganger &&
    profile.actors?.dubbelganger &&
    !targets.dubbelganger.alive
  )
    return {
      integrity,
      failure: "Je hebt de verkeerde persoon uitgeschakeld.",
    };
  return { integrity, failure: null };
}
