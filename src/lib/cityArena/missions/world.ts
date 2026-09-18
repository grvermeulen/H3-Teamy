import { distance } from "../mapBuild/geometry";
import { replacePlayer } from "../sim/players";
import type {
  ArenaInputs,
  ArenaPlayerState,
  ArenaState,
  WorldInput,
} from "../sim/types";
import type { MapIndex } from "../world/mapTypes";
import { distanceToZoneEdge, findZoneByKey } from "../world/zone";
import { missionAnchor, missionTargets } from "./targets";
export { missionAnchor, missionTargets } from "./targets";
import { missionById } from "./catalog";
import { MISSION_CONTACTS, type MissionContact } from "./contacts";
import { settleMission } from "./rewards";
import { optionalMissionAction } from "./optional";
import { missionRecords } from "./progression";
import {
  clearMissionActors,
  missionCondition,
  missionAdversaryIds,
} from "./actors";
import {
  retryMission,
  revealMissionHint,
  startMission,
  stepMission,
} from "./runner";
import type {
  MissionCommand,
  MissionDefinition,
  MissionObjective,
  MissionProfile,
  PrimitiveObjective,
} from "./types";

/** Empty contract history; created on the first interaction rather than for ambient players. */
export function emptyMissionProfile(): MissionProfile {
  return {
    offer: null,
    run: null,
    wallet: { balance: 0, earned: 0, receipts: [] },
    completed: [],
    cooldownUntil: {},
    lastCommand: 0,
    attempt: 0,
  };
}

/** Available street characters for the current map; contacts do not belong to ambient population. */
export function contactsForMap(index: MapIndex): MissionContact[] {
  return MISSION_CONTACTS.filter((contact) => {
    const position = missionAnchor(contact.id);
    const zone = findZoneByKey(index, contact.zone);
    return (
      position &&
      zone &&
      distanceToZoneEdge(zone, position) <= -8 &&
      contact.missions.some((id) => missionById(id))
    );
  });
}

/** The nearest street contact a living player on foot can talk to. */
export function nearbyMissionContact(
  index: MapIndex,
  player: ArenaPlayerState,
): MissionContact | null {
  if (player.diedAtTick !== null || player.vehicleId !== null) return null;
  return (
    contactsForMap(index)
      .map((contact) => ({
        contact,
        gap: distance([player.x, player.y], missionAnchor(contact.id)!),
      }))
      .filter((entry) => entry.gap <= 3)
      .sort(
        (a, b) => a.gap - b.gap || a.contact.id.localeCompare(b.contact.id),
      )[0]?.contact ?? null
  );
}

/** Explains why an authored job cannot currently be accepted. */
export function missionUnavailable(
  definition: MissionDefinition,
  profile: MissionProfile,
  tick: number,
  round: boolean,
  roundTicksLeft?: number,
): string | null {
  if (profile.run?.status === "active")
    return "Rond eerst je huidige missie af.";
  if (round && profile.completed.includes(definition.id))
    return "Deze missie is dit potje al betaald.";
  if (
    roundTicksLeft !== undefined &&
    roundTicksLeft < (definition.estimatedSeconds + 30) * 30
  )
    return "Te weinig speeltijd over voor deze missie.";
  const prerequisite =
    !round &&
    definition.prerequisites.find((id) => !profile.completed.includes(id));
  if (prerequisite)
    return `Voltooi eerst ${missionById(prerequisite)?.title ?? prerequisite}.`;
  if ((profile.cooldownUntil[definition.id] ?? 0) > tick)
    return "Deze opdrachtgever heeft even rust nodig.";
  return null;
}

/** Unfinished primitives, in authored order, used by the interaction prompt and markers. */
export function objectiveParts(
  objective: MissionObjective,
): PrimitiveObjective[] {
  return objective.kind === "composite" ? objective.objectives : [objective];
}

/** Marker aliases for the current objective, including only the next race checkpoint. */
export function missionTargetReferences(player: ArenaPlayerState): string[] {
  const run = player.mission?.run;
  const definition = run && missionById(run.definitionId);
  if (!run || !definition || run.status !== "active") return [];
  return objectiveParts(definition.stages[run.stage].objective).flatMap(
    (objective, index) => {
      const progress = run.objective.children[index] ?? run.objective;
      if (progress.done) return [];
      if (objective.kind === "collect")
        return objective.targets.filter(
          (target) => !progress.collected.includes(target),
        );
      if (objective.kind === "driveCheckpoints")
        return [objective.gates[progress.gate]?.target].filter(
          (target): target is string => Boolean(target),
        );
      if (objective.kind === "escort")
        return [objective.target, objective.destination];
      return "target" in objective ? [objective.target] : [];
    },
  );
}

/** Whether the contextual action belongs to an objective before a nearby car or landmark. */
export function missionInteractionLabel(
  player: ArenaPlayerState,
  state?: Pick<ArenaState, "peds" | "vehicles">,
): string | null {
  const run = player.mission?.run;
  const definition = run && missionById(run.definitionId);
  if (!run || !definition || run.status !== "active") return null;
  const optional = optionalMissionAction(player, state);
  if (optional) return optional.label;
  const targets = missionTargets(definition, state, player.mission);
  for (const objective of objectiveParts(
    definition.stages[run.stage].objective,
  )) {
    const references =
      objective.kind === "collect"
        ? objective.targets.filter((item) => !run.inventory.includes(item))
        : "target" in objective
          ? [objective.target]
          : [];
    if (
      !references.some(
        (reference) =>
          targets[reference]?.alive &&
          distance([player.x, player.y], targets[reference].position) <=
            (objective.kind === "deliver" ? 4 : 3),
      )
    )
      continue;
    switch (objective.kind) {
      case "talk":
        return player.vehicleId === null ? "Praten" : null;
      case "identify":
        return player.vehicleId === null ? "Identiteit controleren" : null;
      case "collect":
        return player.vehicleId === null ? "Oppakken" : null;
      case "deliver":
        if (
          player.speed < 0.5 &&
          objective.items.every((item) => run.inventory.includes(item)) &&
          (!objective.vehicle ||
            player.vehicleId === targets[objective.vehicle]?.id)
        )
          return "Afleveren";
        break;
      case "interact":
        if (player.vehicleId === null && player.speed < 0.5)
          return "Vasthouden";
        break;
      default:
        break;
    }
  }
  return null;
}

function applyCommand(
  state: ArenaState,
  player: ArenaPlayerState,
  command: MissionCommand,
  index: MapIndex,
): ArenaState {
  const old = player.mission ?? emptyMissionProfile();
  if (command.sequence <= old.lastCommand) return state;
  let profile = { ...old, lastCommand: command.sequence };
  const definition = command.missionId
    ? missionById(command.missionId)
    : old.offer
      ? missionById(old.offer)
      : old.run
        ? missionById(old.run.definitionId)
        : undefined;
  const contact = nearbyMissionContact(index, player);
  if (
    command.kind === "accept" &&
    definition &&
    missionUnavailable(
      definition,
      old,
      state.tick,
      state.zoneEnforced,
      state.roundTicksLeft,
    )
  )
    profile.offer = null;
  if (command.kind === "close") profile.offer = null;
  if (command.kind === "hint" && old.run)
    profile.run = revealMissionHint(old.run);
  if (command.kind === "abandon" && old.run?.status === "active")
    profile.run = {
      ...old.run,
      status: "abandoned",
      failure: "Je hebt de missie gestopt.",
    };
  if (
    command.kind === "retry" &&
    old.run?.status === "failed" &&
    definition &&
    player.diedAtTick === null
  ) {
    state = clearMissionActors(state, old);
    profile = {
      ...profile,
      run: retryMission(definition, old.run, state.tick, !state.zoneEnforced),
      actors: {},
      appliedStage: undefined,
      cargoIntegrity: 100,
    };
  }
  if (
    definition &&
    contact?.id === definition.contact &&
    !missionUnavailable(
      definition,
      old,
      state.tick,
      state.zoneEnforced,
      state.roundTicksLeft,
    )
  ) {
    if (command.kind === "offer") profile.offer = definition.id;
    if (command.kind === "accept" && old.offer === definition.id) {
      const attempt = old.attempt + 1;
      state = clearMissionActors(state, old);
      profile = {
        ...profile,
        actors: {},
        appliedStage: undefined,
        cargoIntegrity: 100,
        offer: null,
        attempt,
        run: startMission(
          definition,
          player.id,
          `${state.seed}:${player.id}:${definition.id}:${attempt}`,
          state.tick,
          !state.zoneEnforced && old.completed.includes(definition.id),
        ),
      };
    }
  }
  return replacePlayer(state, { ...player, mission: profile });
}

/** Handles reliable menu intents and contextual E presses before vehicle boarding. */
export function handleMissionInput(
  state: ArenaState,
  player: ArenaPlayerState,
  input: WorldInput,
  enterPressed: boolean,
  index: MapIndex,
): { state: ArenaState; handled: boolean } {
  if (player.diedAtTick !== null) return { state, handled: false };
  if (input.missionCommand) {
    const next = applyCommand(state, player, input.missionCommand, index);
    if (next !== state) return { state: next, handled: true };
  }
  if (player.mission?.offer) {
    if (!enterPressed) return { state, handled: true };
    return {
      state: applyCommand(
        state,
        player,
        { sequence: player.mission.lastCommand + 1, kind: "accept" },
        index,
      ),
      handled: true,
    };
  }
  if (input.enter && missionInteractionLabel(player, state))
    return { state, handled: true };
  const contact = nearbyMissionContact(index, player);
  if (!contact || !enterPressed) return { state, handled: false };
  const profile = player.mission ?? emptyMissionProfile();
  const definition = contact.missions
    .map(missionById)
    .find(
      (entry) =>
        entry &&
        !missionUnavailable(
          entry,
          profile,
          state.tick,
          state.zoneEnforced,
          state.roundTicksLeft,
        ),
    );
  if (!definition) return { state, handled: false };
  return {
    state: replacePlayer(state, {
      ...player,
      mission: { ...profile, offer: definition.id },
    }),
    handled: true,
  };
}

/** Settles objectives after world movement and combat; event replay cannot duplicate cash. */
export function stepWorldMissions(
  state: ArenaState,
  previous: ArenaState,
  inputs: ArenaInputs,
  index: MapIndex,
): ArenaState {
  let next = state;
  const adversaries = missionAdversaryIds(state);
  for (const player of state.players) {
    const profile = player.mission;
    if (!profile) continue;
    const before =
      previous.players.find((entry) => entry.id === player.id) ?? player;
    if (
      profile.offer &&
      (player.health < before.health ||
        nearbyMissionContact(index, player)?.id !==
          missionById(profile.offer)?.contact)
    ) {
      next = replacePlayer(next, {
        ...player,
        mission: { ...profile, offer: null },
      });
      continue;
    }
    const run = profile.run;
    const definition = run && missionById(run.definitionId);
    if (!run || !definition || run.status !== "active") continue;
    const input = inputs.get(player.id);
    const optional = optionalMissionAction(player, state);
    const interactingOptional = Boolean(optional && input?.enter);
    const updatedProfile =
      interactingOptional && optional?.recharge
        ? {
            ...profile,
            cargoIntegrity: Math.min(100, (profile.cargoIntegrity ?? 100) + 1),
          }
        : profile;
    const condition = missionCondition(state, updatedProfile);
    const withPickup =
      interactingOptional &&
      optional &&
      !optional.recharge &&
      !before.held.enter
        ? {
            ...run,
            inventory: [...new Set([...run.inventory, optional.alias])],
          }
        : run;
    const moved = stepMission(definition, withPickup, {
      tick: state.tick,
      playerId: player.id,
      position: [player.x, player.y],
      previousPosition: [before.x, before.y],
      teleported: distance([player.x, player.y], [before.x, before.y]) > 10,
      alive: player.diedAtTick === null,
      speed: player.speed,
      vehicleId: player.vehicleId,
      wanted: player.heat,
      interacting: Boolean(
        input?.enter && !interactingOptional && player.health >= before.health,
      ),
      interacted: Boolean(
        input?.enter && !before.held.enter && !interactingOptional,
      ),
      targets: missionTargets(definition, state, profile),
      kills: state.events.flatMap((event) =>
        event.kind === "kill" && event.victimId !== null
          ? [{ victimId: event.victimId, killerId: event.killerId }]
          : [],
      ),
      hijackedVehicleIds: state.events.flatMap((event) =>
        event.kind === "hijack" && event.playerId === player.id
          ? [event.vehicleId]
          : [],
      ),
      civilianKills: state.events.filter(
        (event) =>
          event.kind === "kill" &&
          event.victim === "ped" &&
          (event.victimId === null || !adversaries.has(event.victimId)) &&
          event.killerId === player.id,
      ).length,
      minimumIntegrity: condition.integrity,
      essentialFailure: condition.failure,
    });
    const wallet = settleMission(profile.wallet, definition, moved);
    const completed = moved.status === "completed";
    next = replacePlayer(next, {
      ...player,
      mission: {
        ...profile,
        run: moved,
        cargoIntegrity: updatedProfile.cargoIntegrity,
        wallet,
        records:
          completed && wallet !== profile.wallet
            ? missionRecords(
                profile,
                definition,
                moved,
                wallet.receipts[wallet.receipts.length - 1],
              )
            : profile.records,
        completed: completed
          ? [...new Set([...profile.completed, definition.id])]
          : profile.completed,
        cooldownUntil: completed
          ? { ...profile.cooldownUntil, [definition.id]: state.tick + 9000 }
          : profile.cooldownUntil,
      },
    });
  }
  return next;
}
