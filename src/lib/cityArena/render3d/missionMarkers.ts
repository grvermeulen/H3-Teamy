/**
 * What the 3D view shows of the missions, read from the scene as the 2D `drawMissions` reads it:
 * the street contacts (where each stands and the look they wear) and a beacon over each — in the
 * contact's colour while one of their jobs is open, grey otherwise — plus a beacon over every
 * target of your current objective. Pure: no three.js here.
 *
 * Working out which jobs are open and where the targets are takes the mission catalogue and
 * allocates, so it runs when the contact list or something the markers read from your mission
 * changes (its stage, progress, inventory, completed jobs, bound actors — not the clocks the
 * simulation moves every tick) and otherwise every {@link MARKER_REFRESH_TICKS}; in between, a
 * frame only moves the beacons of targets that walk or drive, and allocates nothing.
 */
import { missionById } from "../missions/catalog";
import { MISSION_CONTACTS, type MissionContact } from "../missions/contacts";
import { missionScenario } from "../missions/scenarios";
import type {
  MissionProfile,
  MissionRun,
  MissionTarget,
  ObjectiveProgress,
} from "../missions/types";
import {
  emptyMissionProfile,
  missionAnchor,
  missionTargetReferences,
  missionTargets,
  missionUnavailable,
} from "../missions/world";
import type { Scene } from "../render/renderScene";
import type { ArenaPlayerState } from "../sim/types";
import { pedLookOf, type CharacterLook } from "./characterLooks";

/** Open jobs and target positions are worked out again at least this often, 30 Hz ticks. */
export const MARKER_REFRESH_TICKS = 15;
/** A contact with no job open to you: the 2D map's grey. */
export const CONTACT_UNAVAILABLE_COLOUR = 0xb4b4bd;
/** A target of your current objective: the 2D map's yellow. */
export const OBJECTIVE_COLOUR = 0xfde047;
/** An optional target (a recharge, a pickup on the way): the 2D map's cyan. */
export const OPTIONAL_OBJECTIVE_COLOUR = 0x67e8f9;
/** Radix of a CSS hex colour. */
const HEX_RADIX = 16;
/** Seed and step of the running hash behind {@link missionSignature}. */
const SIGNATURE_SEED = 17;
const SIGNATURE_STEP = 31;
/** A run's statuses, numbered for the hash. */
const RUN_STATUSES: readonly MissionRun["status"][] = [
  "active",
  "completed",
  "failed",
  "abandoned",
];
/** A contact list when the scene has none. */
const NO_CONTACTS: readonly MissionContact[] = [];

/** A contact standing on the street. */
export type ContactSpot = {
  /** Stable per contact: their place in the full contact list. */
  key: number;
  /** World metres. */
  x: number;
  y: number;
  /** The look the 2D map draws them in. */
  look: CharacterLook;
};

/** A beacon's foot and colour. */
export type BeaconSpot = { x: number; y: number; colour: number };

/** What the markers read from a frame's scene. */
export type MissionMarkerScene = Pick<
  Scene,
  | "missionContacts"
  | "missionRound"
  | "players"
  | "localPlayerId"
  | "peds"
  | "vehicles"
  | "tick"
>;

/** The mission markers, rewritten by every `update`. */
export type MissionMarkers = {
  /** Reads a frame's scene. */
  update(scene: MissionMarkerScene): void;
  /** The contacts, in the scene's order. */
  readonly contacts: readonly ContactSpot[];
  /** The contacts' beacons, in the same order, then your objective's targets. */
  readonly beacons: readonly BeaconSpot[];
};

/** A contact with their spot, beacon and own colour. */
type Standing = {
  contact: MissionContact;
  spot: ContactSpot;
  beacon: BeaconSpot;
  colour: number;
};

/** A target's beacon, and the person or car it stands over (their id), if it moves. */
type Objective = { spot: BeaconSpot; follows: number | null };

type MarkerState = {
  list: readonly MissionContact[];
  standing: Standing[];
  contacts: ContactSpot[];
  objectives: Objective[];
  beacons: BeaconSpot[];
  primed: boolean;
  /** The profile last looked at, and what the markers read from it: its signature and job. */
  profileSeen: MissionProfile | undefined;
  signature: number;
  definitionId: string | null;
  round: boolean;
  refreshedTick: number;
};

/** This client's player in the scene. */
function localPlayer(scene: MissionMarkerScene): ArenaPlayerState | undefined {
  for (const player of scene.players)
    if (player.id === scene.localPlayerId) return player;
  return undefined;
}

/** True when two contact lists hold the same contacts in the same order. */
function sameContacts(
  a: readonly MissionContact[],
  b: readonly MissionContact[],
): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++)
    if (a[index] !== b[index]) return false;
  return true;
}

/** Stands the listed contacts that have an anchor on the map. */
function standContacts(list: readonly MissionContact[]): Standing[] {
  const standing: Standing[] = [];
  for (const contact of list) {
    const anchor = missionAnchor(contact.id);
    if (!anchor) continue;
    const [x, y] = anchor;
    const colour = Number.parseInt(contact.colour.slice(1), HEX_RADIX);
    standing.push({
      contact,
      spot: {
        key: MISSION_CONTACTS.indexOf(contact),
        x,
        y,
        look: pedLookOf(contact.look),
      },
      beacon: { x, y, colour },
      colour,
    });
  }
  return standing;
}

/** Whether any of a contact's jobs could be taken now, by the 2D map's rule. */
function hasOpenJob(
  contact: MissionContact,
  profile: MissionProfile,
  tick: number,
  round: boolean,
): boolean {
  return contact.missions.some((id) => {
    const definition = missionById(id);
    return Boolean(
      definition && !missionUnavailable(definition, profile, tick, round),
    );
  });
}

/** The person or car with an id this frame (the simulation shares one id counter). */
function entityWithId(
  scene: MissionMarkerScene,
  id: number,
): { x: number; y: number } | undefined {
  for (const ped of scene.peds) if (ped.id === id) return ped;
  for (const car of scene.vehicles) if (car.id === id) return car;
  return undefined;
}

/** The person or car with the target's id standing exactly on it, which it then follows. */
function followedId(
  target: MissionTarget,
  scene: MissionMarkerScene,
): number | null {
  if (target.id <= 0) return null;
  const entity = entityWithId(scene, target.id);
  const [x, y] = target.position;
  return entity && entity.x === x && entity.y === y ? target.id : null;
}

/** Your current objective's targets, then the optional ones still to fetch, as the 2D map marks them. */
function objectivesOf(
  player: ArenaPlayerState | undefined,
  scene: MissionMarkerScene,
): Objective[] {
  const run = player?.mission?.run;
  const definition = run?.status === "active" && missionById(run.definitionId);
  if (!player || !run || !definition) return [];
  const targets = missionTargets(definition, scene, player.mission);
  const scenario = missionScenario(definition);
  const optional = [scenario.recharge, scenario.optionalPickup?.alias].filter(
    (alias): alias is string => !!alias && !run.inventory.includes(alias),
  );
  const found: Objective[] = [];
  for (const alias of [...missionTargetReferences(player), ...optional]) {
    const target = targets[alias];
    if (!target) continue;
    const [x, y] = target.position;
    const colour = optional.includes(alias)
      ? OPTIONAL_OBJECTIVE_COLOUR
      : OBJECTIVE_COLOUR;
    found.push({ spot: { x, y, colour }, follows: followedId(target, scene) });
  }
  return found;
}

/** Moves each moving target's beacon to where its person or car is this frame. */
function followObjectives(
  objectives: readonly Objective[],
  scene: MissionMarkerScene,
): void {
  for (const { spot, follows } of objectives) {
    const entity = follows === null ? undefined : entityWithId(scene, follows);
    if (!entity) continue;
    spot.x = entity.x;
    spot.y = entity.y;
  }
}

/** Folds a number into a running hash. */
function fold(hash: number, value: number): number {
  return (hash * SIGNATURE_STEP + value) | 0;
}

/** Folds an objective's progress into a hash: what is done, collected and passed. */
function foldProgress(hash: number, progress: ObjectiveProgress): number {
  let next = fold(hash, progress.done ? 1 : 0);
  next = fold(fold(next, progress.collected.length), progress.gate);
  for (const child of progress.children) next = foldProgress(next, child);
  return next;
}

/**
 * A number that changes when anything the markers read from a mission profile does — the run's
 * status, stage, progress and inventory, the jobs completed, the actors bound — but not with the
 * run's clocks, which the simulation moves every tick. Allocates nothing.
 */
function missionSignature(profile: MissionProfile | undefined): number {
  if (!profile) return 0;
  let hash = fold(SIGNATURE_SEED, profile.completed.length);
  for (const alias in profile.actors)
    hash = fold(hash, profile.actors[alias].id);
  const run = profile.run;
  if (!run) return hash;
  hash = fold(hash, RUN_STATUSES.indexOf(run.status));
  hash = fold(fold(hash, run.stage), run.inventory.length);
  return foldProgress(hash, run.objective);
}

/** Takes note of your profile; true when something the markers read from it has changed. */
function profileMoved(
  state: MarkerState,
  profile: MissionProfile | undefined,
): boolean {
  if (profile === state.profileSeen) return false;
  state.profileSeen = profile;
  const signature = missionSignature(profile);
  const definitionId = profile?.run?.definitionId ?? null;
  const moved =
    signature !== state.signature || definitionId !== state.definitionId;
  state.signature = signature;
  state.definitionId = definitionId;
  return moved;
}

/** True when the open jobs and targets must be worked out again this frame. */
function refreshDue(
  state: MarkerState,
  player: ArenaPlayerState | undefined,
  scene: MissionMarkerScene,
): boolean {
  const moved = profileMoved(state, player?.mission);
  const age = scene.tick - state.refreshedTick;
  return (
    !state.primed ||
    moved ||
    (scene.missionRound ?? false) !== state.round ||
    age < 0 ||
    age >= MARKER_REFRESH_TICKS
  );
}

/** Colours the contacts' beacons and finds the objective's targets again. */
function refresh(
  state: MarkerState,
  player: ArenaPlayerState | undefined,
  scene: MissionMarkerScene,
): void {
  const profile = player?.mission ?? emptyMissionProfile();
  const round = scene.missionRound ?? false;
  for (const standing of state.standing)
    standing.beacon.colour = hasOpenJob(
      standing.contact,
      profile,
      scene.tick,
      round,
    )
      ? standing.colour
      : CONTACT_UNAVAILABLE_COLOUR;
  state.objectives = objectivesOf(player, scene);
  state.beacons = [
    ...state.standing.map((standing) => standing.beacon),
    ...state.objectives.map((objective) => objective.spot),
  ];
  state.primed = true;
  state.round = round;
  state.refreshedTick = scene.tick;
}

/**
 * Creates the mission markers.
 *
 * @returns The markers; call `update` once per frame, then read `contacts` and `beacons`.
 */
export function createMissionMarkers(): MissionMarkers {
  const state: MarkerState = {
    list: NO_CONTACTS,
    standing: [],
    contacts: [],
    objectives: [],
    beacons: [],
    primed: false,
    profileSeen: undefined,
    signature: 0,
    definitionId: null,
    round: false,
    refreshedTick: 0,
  };
  return {
    update(scene) {
      const list = scene.missionContacts ?? NO_CONTACTS;
      const player = localPlayer(scene);
      const restood = !sameContacts(state.list, list);
      if (restood) {
        state.list = list;
        state.standing = standContacts(list);
        state.contacts = state.standing.map((standing) => standing.spot);
      }
      // Always asked, so the profile it has seen stays current.
      const due = refreshDue(state, player, scene);
      if (restood || due) refresh(state, player, scene);
      else followObjectives(state.objectives, scene);
    },
    get contacts() {
      return state.contacts;
    },
    get beacons() {
      return state.beacons;
    },
  };
}
