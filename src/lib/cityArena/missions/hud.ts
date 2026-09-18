import { distance } from "../mapBuild/geometry";
import type { ArenaPlayerState, ArenaState } from "../sim/types";
import type { MapIndex } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { missionById } from "./catalog";
import { missionScenario } from "./scenarios";
import type { MissionDefinition, MissionProfile } from "./types";
import {
  contactsForMap,
  missionAnchor,
  emptyMissionProfile,
  missionInteractionLabel,
  missionTargetReferences,
  missionTargets,
  missionUnavailable,
  nearbyMissionContact,
} from "./world";

/** Named destination with a visible availability symbol on the full map. */
export type MissionMapMarker = {
  id: string;
  title: string;
  position: Point;
  state: "available" | "locked" | "active" | "completed";
};

/** Contact and active objective destinations for the accessible map picker. */
export function missionMapMarkers(
  index: MapIndex,
  state: ArenaState,
  player: ArenaPlayerState,
): MissionMapMarker[] {
  const profile = player.mission ?? emptyMissionProfile();
  const markers = contactsForMap(index).map((contact): MissionMapMarker => {
    const jobs = contact.missions
      .map(missionById)
      .filter((entry): entry is MissionDefinition => Boolean(entry));
    return {
      id: contact.id,
      title: contact.name,
      position: missionAnchor(contact.id)!,
      state: jobs.every((job) => profile.completed.includes(job.id))
        ? "completed"
        : jobs.some(
              (job) =>
                !missionUnavailable(
                  job,
                  profile,
                  state.tick,
                  state.zoneEnforced,
                  state.roundTicksLeft,
                ),
            )
          ? "available"
          : "locked",
    };
  });
  const hud = missionHud(index, state, player);
  if (hud.definition && profile.run?.status === "active") {
    const targets = missionTargets(hud.definition, state, profile);
    const scenario = missionScenario(hud.definition);
    const optional = [scenario.recharge, scenario.optionalPickup?.alias].filter(
      (alias): alias is string =>
        !!alias && !profile.run!.inventory.includes(alias),
    );
    for (const alias of [...missionTargetReferences(player), ...optional]) {
      const target = targets[alias];
      if (target)
        markers.push({
          id: `objective:${alias}`,
          title: `${optional.includes(alias) ? "Optioneel: " : ""}${hud.definition.title}: ${alias}`,
          position: target.position,
          state: "active",
        });
    }
  }
  return markers;
}

/** Read-only projection for the mission panel and contextual controls. */
export type MissionHud = {
  profile: MissionProfile;
  definition: MissionDefinition | null;
  offer: MissionDefinition | null;
  contact: {
    name: string;
    greeting: string;
    jobs: { id: string; title: string; unavailable: string | null }[];
  } | null;
  action: string | null;
  destination: Point | null;
  distanceM: number | null;
  secondsLeft: number | null;
  meters?: { label: string; value: number; max: number }[];
};

/** Computes dialogue, availability and route information from authoritative state. */
export function missionHud(
  index: MapIndex | null,
  state: ArenaState,
  player: ArenaPlayerState,
): MissionHud {
  const profile = player.mission ?? emptyMissionProfile();
  const definition = profile.run
    ? (missionById(profile.run.definitionId) ?? null)
    : null;
  const contact = index ? nearbyMissionContact(index, player) : null;
  const targets = definition ? missionTargets(definition, state, profile) : {};
  const destination =
    targets[missionTargetReferences(player)[0]]?.position ?? null;
  const run = profile.run;
  const stage = definition && run ? definition.stages[run.stage] : null;
  const deadlines =
    run && definition
      ? [
          definition.deadlineSeconds
            ? run.startedTick + definition.deadlineSeconds * 30
            : Infinity,
          stage?.deadlineSeconds
            ? run.stageTick + stage.deadlineSeconds * 30
            : Infinity,
        ]
      : [];
  const deadline = Math.min(...deadlines);
  return {
    profile,
    definition,
    offer: profile.offer ? (missionById(profile.offer) ?? null) : null,
    contact: contact
      ? {
          name: contact.name,
          greeting: contact.greeting,
          jobs: contact.missions.flatMap((id) => {
            const job = missionById(id);
            return job
              ? [
                  {
                    id,
                    title: job.title,
                    unavailable: missionUnavailable(
                      job,
                      profile,
                      state.tick,
                      state.zoneEnforced,
                      state.roundTicksLeft,
                    ),
                  },
                ]
              : [];
          }),
        }
      : null,
    action:
      missionInteractionLabel(player, state) ??
      (contact ? `Praat met ${contact.name}` : null),
    destination,
    distanceM: destination
      ? Math.round(distance([player.x, player.y], destination))
      : null,
    secondsLeft: Number.isFinite(deadline)
      ? Math.max(0, Math.ceil((deadline - state.tick) / 30))
      : null,
    meters:
      run?.status === "active" && stage
        ? [
            ...("seconds" in stage.objective
              ? [
                  {
                    label:
                      stage.objective.kind === "follow"
                        ? "Volgen"
                        : "Voortgang",
                    value: run.objective.ticks / 30,
                    max: stage.objective.seconds,
                  },
                ]
              : []),
            ...(stage.objective.kind === "follow"
              ? [
                  {
                    label: "Verdenking",
                    value: run.objective.suspicion,
                    max: 150,
                  },
                ]
              : []),
            ...(stage.objective.kind === "driveCheckpoints"
              ? [
                  {
                    label: "Controlepunten",
                    value: run.objective.gate,
                    max: stage.objective.gates.length,
                  },
                ]
              : []),
            ...(definition?.id === "M13"
              ? [
                  {
                    label: "Koeling",
                    value: profile.cargoIntegrity ?? 100,
                    max: 100,
                  },
                ]
              : []),
            ...(definition?.bonus.rule.kind === "integrity" &&
            definition.id !== "M13"
              ? [{ label: "Conditie", value: run.minimumIntegrity, max: 100 }]
              : []),
          ]
        : [],
  };
}
