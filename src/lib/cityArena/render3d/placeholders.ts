/**
 * Stand-ins for the 3D city and its cast until the real world cells (Task 11), characters
 * (Task 12) and vehicles (Task 14) are wired in (Task 16): a tarmac ground plane, grey extruded
 * footprints for the buildings near the player, capsules for people and boxes for cars — enough
 * to drive and walk around. The two layers mirror the shapes of `WorldCells` and `EntitySync`, so
 * swapping them is a one-line change in `index.ts`.
 */
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ExtrudeGeometry,
  GridHelper,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Shape,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import type { Scene as ArenaScene } from "../render/renderScene";
import { CAR_BODY_COLOURS } from "../render/palette";
import { lengthOf, widthOf } from "../sim/vehicle";
import type { DecodedBuilding, DecodedTile } from "../world/decode";
import { headingToRotationY } from "./coords";
import { disposeObject } from "./disposal";

/** A structure's damage as the 3D view reads it (mirrors the simulation's `StructureState`). */
export type PlaceholderStructure = {
  id: number;
  damage: number;
  destroyedAtTick: number | null;
};

/** Buildings farther than this from the player are not built, metres (the brief's 200 m). */
export const PLACEHOLDER_BUILDING_RADIUS_M = 200;
/** A building is dropped again only beyond this share of the radius, so edges do not flicker. */
const BUILDING_KEEP_SHARE = 1.25;
/** The player must move this far before the building set is scanned again, metres. */
const RESCAN_DISTANCE_M = 16;
/** Storey height and the lowest building, metres (spec §6.5). */
const STOREY_M = 3.1;
const MIN_BUILDING_HEIGHT_M = 3.5;
/** Side of the ground plane that follows the player, metres; fog hides its edge. */
const GROUND_SIZE_M = 2400;
/** A world-fixed grid on the ground gives the eye something to judge speed by, metres. */
const GRID_CELL_M = 10;
const GRID_SIZE_M = 600;
/** The grid floats this far over the ground so the two never z-fight, metres. */
const GRID_LIFT_M = 0.02;
/** People and cars farther than this from the player are not drawn, metres. */
const ENTITY_DRAW_DISTANCE_M = 320;
/** Capsule people: radius, straight middle and the resulting standing centre height, metres. */
const PERSON_RADIUS_M = 0.3;
const PERSON_BODY_M = 1.1;
const PERSON_CENTRE_M = PERSON_BODY_M / 2 + PERSON_RADIUS_M;
/** Box cars stand this tall, metres. */
const CAR_HEIGHT_M = 1.4;
/** Placeholder colours: dark tarmac, grey buildings, and one tone per kind of person. */
const TARMAC = 0x2b2e33;
const GRID_LINE = 0x4a515c;
const BUILDING_GREY = 0x8a8f98;
const LOCAL_PLAYER_MINT = 0x5ee6b0;
const OTHER_PLAYER_ORANGE = 0xff9a3c;
const PED_GREY = 0xa3a8ae;
const COP_NAVY = 0x1d2f6f;
const WRECK_BLACK = 0x1c1c1c;

/** Squared distance from `(x, y)` to the nearest point of a rectangle. */
function distanceSquaredToRect(
  x: number,
  y: number,
  rect: DecodedBuilding["bounds"],
): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dy = Math.max(rect.minY - y, 0, y - rect.maxY);
  return dx * dx + dy * dy;
}

/**
 * A footprint extruded to its height (spec §6.5: `levels × 3.1 m`, at least 3.5 m). The shape is
 * drawn with y negated and turned −90° about X, which lays world `(x, y)` onto three's `(x, 0, y)`
 * and extrudes upward.
 *
 * @param building - The decoded footprint.
 * @returns The geometry in world coordinates, or `null` for a degenerate ring.
 */
export function buildingGeometry(
  building: DecodedBuilding,
): BufferGeometry | null {
  if (building.ring.length < 3) return null;
  const shape = new Shape();
  building.ring.forEach(([x, y], index) =>
    index === 0 ? shape.moveTo(x, -y) : shape.lineTo(x, -y),
  );
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(MIN_BUILDING_HEIGHT_M, building.levels * STOREY_M),
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** The ground and buildings layer; same `update` shape as the real `WorldCells`. */
export type PlaceholderWorld = {
  group: Group;
  update(
    focus: { x: number; y: number },
    tiles: readonly DecodedTile[],
    structures: readonly PlaceholderStructure[],
    viewDistance: number,
    budgetMs: number,
  ): void;
  /** How many buildings are standing in the layer. */
  buildingCount(): number;
  dispose(): void;
};

/** Same tiles in the same order: the session hands out a fresh array each frame. */
function sameTiles(
  first: readonly DecodedTile[],
  second: readonly DecodedTile[],
): boolean {
  return (
    first.length === second.length &&
    first.every((tile, index) => tile === second[index])
  );
}

/** The ids of destroyed structures. */
function destroyedIds(
  structures: readonly PlaceholderStructure[],
): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const structure of structures)
    if (structure.destroyedAtTick !== null) ids.add(structure.id);
  return ids;
}

/** A key that changes exactly when the set of destroyed structures does; `""` while none is. */
function destroyedKey(structures: readonly PlaceholderStructure[]): string {
  let key = "";
  for (const structure of structures)
    if (structure.destroyedAtTick !== null) key += `${structure.id},`;
  return key;
}

/** Building bookkeeping for {@link createPlaceholderWorld}. */
type BuildingLayer = {
  group: Group;
  material: Material;
  built: Map<number, { mesh: Mesh; building: DecodedBuilding }>;
  queue: DecodedBuilding[];
};

/** Drops buildings beyond the keep radius or destroyed, then queues the missing ones nearest first. */
function rescanBuildings(
  layer: BuildingLayer,
  focus: { x: number; y: number },
  tiles: readonly DecodedTile[],
  destroyed: ReadonlySet<number>,
  radius: number,
): void {
  const keep = (radius * BUILDING_KEEP_SHARE) ** 2;
  for (const [id, entry] of layer.built) {
    const far = distanceSquaredToRect(focus.x, focus.y, entry.building.bounds);
    if (far <= keep && !destroyed.has(id)) continue;
    layer.group.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    layer.built.delete(id);
  }
  const reach = radius * radius;
  const distance = (building: DecodedBuilding): number =>
    distanceSquaredToRect(focus.x, focus.y, building.bounds);
  layer.queue = tiles
    .flatMap((tile) => tile.buildings)
    .filter(
      (building) =>
        !layer.built.has(building.structureId) &&
        !destroyed.has(building.structureId) &&
        distance(building) <= reach,
    )
    .sort((first, second) => distance(first) - distance(second));
}

/** Builds queued buildings until `budgetMs` runs out, always at least one per call. */
function buildQueued(layer: BuildingLayer, budgetMs: number): void {
  const start = performance.now();
  let first = true;
  while (layer.queue.length > 0) {
    if (!first && performance.now() - start >= budgetMs) return;
    first = false;
    const building = layer.queue.shift()!;
    const geometry = buildingGeometry(building);
    if (!geometry) continue;
    const mesh = new Mesh(geometry, layer.material);
    layer.group.add(mesh);
    layer.built.set(building.structureId, { mesh, building });
  }
}

/** What the building set was last scanned for. */
type Scan = {
  x: number;
  y: number;
  tiles: readonly DecodedTile[];
  destroyed: string;
};

/** True when the player moved far enough, the tiles changed or a building fell since `scan`. */
function needsRescan(scan: Scan | null, next: Scan): boolean {
  return (
    !scan ||
    Math.hypot(next.x - scan.x, next.y - scan.y) >= RESCAN_DISTANCE_M ||
    !sameTiles(next.tiles, scan.tiles) ||
    next.destroyed !== scan.destroyed
  );
}

/** A tarmac plane that follows the player, with a grid fixed to the world over it. */
function createGround(): {
  objects: Object3D[];
  follow(focus: { x: number; y: number }): void;
} {
  const ground = new Mesh(
    new PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M),
    new MeshLambertMaterial({ color: TARMAC }),
  );
  ground.rotation.x = -Math.PI / 2;
  const grid = new GridHelper(
    GRID_SIZE_M,
    GRID_SIZE_M / GRID_CELL_M,
    GRID_LINE,
    GRID_LINE,
  );
  const snap = (metres: number): number =>
    Math.round(metres / GRID_CELL_M) * GRID_CELL_M;
  return {
    objects: [ground, grid],
    follow(focus) {
      ground.position.set(focus.x, 0, focus.y);
      grid.position.set(snap(focus.x), GRID_LIFT_M, snap(focus.y));
    },
  };
}

/**
 * The placeholder city: a ground plane under the player and grey extruded footprints within
 * {@link PLACEHOLDER_BUILDING_RADIUS_M} (or the view distance, if shorter). The set is rescanned
 * only when the player has moved {@link RESCAN_DISTANCE_M}, the loaded tiles or the destroyed
 * buildings changed; new buildings are built nearest first within the frame's budget.
 *
 * @returns The layer; add its `group` to the scene.
 */
export function createPlaceholderWorld(): PlaceholderWorld {
  const group = new Group();
  const ground = createGround();
  const layer: BuildingLayer = {
    group: new Group(),
    material: new MeshLambertMaterial({ color: BUILDING_GREY }),
    built: new Map(),
    queue: [],
  };
  group.add(ground.objects[0]!, layer.group, ground.objects[1]!);
  let scanned: Scan | null = null;
  return {
    group,
    update(focus, tiles, structures, viewDistance, budgetMs) {
      ground.follow(focus);
      const destroyed = destroyedKey(structures);
      const next = { x: focus.x, y: focus.y, tiles, destroyed };
      if (needsRescan(scanned, next)) {
        const radius = Math.min(viewDistance, PLACEHOLDER_BUILDING_RADIUS_M);
        rescanBuildings(layer, focus, tiles, destroyedIds(structures), radius);
        scanned = next;
      }
      buildQueued(layer, budgetMs);
    },
    buildingCount: () => layer.built.size,
    dispose() {
      // The shared building material hangs off no mesh once every building is gone.
      disposeObject(group);
      layer.material.dispose();
      layer.built.clear();
    },
  };
}

/** Meshes keyed by entity id, recycled through a free list once their entity is gone. */
export type MeshPool = {
  /** Starts a frame: every entity must be acquired again to stay visible. */
  begin(): void;
  /** The mesh for `id` this frame, reusing a released one before creating another. */
  acquire(id: number): Mesh;
  /** Ends a frame: hides and frees the meshes of entities not acquired since {@link begin}. */
  end(): void;
  /** Meshes created so far, in use or free. */
  created(): number;
};

/**
 * A pool of meshes by entity id: no geometry or material is created per frame, and a mesh is
 * created only when more entities are on screen than ever before.
 *
 * @param parent - Where new meshes are added.
 * @param make - Creates a mesh when the free list is empty.
 * @returns The pool.
 */
export function createMeshPool(parent: Group, make: () => Mesh): MeshPool {
  const active = new Map<number, { mesh: Mesh; frame: number }>();
  const free: Mesh[] = [];
  let frame = 0;
  let created = 0;
  return {
    begin() {
      frame += 1;
    },
    acquire(id) {
      let entry = active.get(id);
      if (!entry) {
        let mesh = free.pop();
        if (!mesh) {
          mesh = make();
          parent.add(mesh);
          created += 1;
        }
        entry = { mesh, frame };
        active.set(id, entry);
      }
      entry.frame = frame;
      entry.mesh.visible = true;
      return entry.mesh;
    },
    end() {
      for (const [id, entry] of active) {
        if (entry.frame === frame) continue;
        entry.mesh.visible = false;
        free.push(entry.mesh);
        active.delete(id);
      }
    },
    created: () => created,
  };
}

/** The people and cars layer; the same `update` inputs as the real `EntitySync` plus the first-person flag. */
export type PlaceholderEntities = {
  group: Group;
  update(
    scene: ArenaScene,
    focus: { x: number; y: number },
    options: { hideLocalPlayer: boolean },
  ): void;
  dispose(): void;
};

/** The pools and shared materials of {@link createPlaceholderEntities}. */
type EntityKit = {
  players: MeshPool;
  peds: MeshPool;
  cops: MeshPool;
  cars: MeshPool;
  person: Record<"local" | "other" | "ped" | "cop", Material>;
  carColours: Material[];
  wreck: Material;
};

/** Stands (or lays down) a capsule at a world point. */
function placePerson(
  mesh: Mesh,
  x: number,
  y: number,
  facing: number,
  dead: boolean,
  material: Material,
): void {
  mesh.material = material;
  mesh.position.set(x, dead ? PERSON_RADIUS_M : PERSON_CENTRE_M, y);
  mesh.rotation.set(0, headingToRotationY(facing), dead ? Math.PI / 2 : 0);
}

/** True when `(x, y)` is within the entity draw distance of `focus`. */
function near(focus: { x: number; y: number }, x: number, y: number): boolean {
  return Math.hypot(x - focus.x, y - focus.y) <= ENTITY_DRAW_DISTANCE_M;
}

/** Places the players, pedestrians and officers of one frame. */
function placePeople(
  kit: EntityKit,
  scene: ArenaScene,
  focus: { x: number; y: number },
  hideLocalPlayer: boolean,
): void {
  for (const player of scene.players) {
    const local = player.id === scene.localPlayerId;
    if (player.vehicleId !== null || (local && hideLocalPlayer)) continue;
    if (!near(focus, player.x, player.y)) continue;
    const mesh = kit.players.acquire(player.id);
    const material = local ? kit.person.local : kit.person.other;
    const dead = player.diedAtTick !== null;
    placePerson(mesh, player.x, player.y, player.facing, dead, material);
  }
  for (const ped of scene.peds) {
    if (!near(focus, ped.x, ped.y)) continue;
    const mesh = kit.peds.acquire(ped.id);
    const dead = ped.mode === "dead";
    placePerson(mesh, ped.x, ped.y, ped.facing, dead, kit.person.ped);
  }
  for (const cop of scene.cops) {
    if (!near(focus, cop.x, cop.y)) continue;
    const mesh = kit.cops.acquire(cop.id);
    const dead = cop.diedAtTick !== null;
    placePerson(mesh, cop.x, cop.y, cop.facing, dead, kit.person.cop);
  }
}

/** Places the cars of one frame as boxes at their kind's size. */
function placeCars(
  kit: EntityKit,
  scene: ArenaScene,
  focus: { x: number; y: number },
): void {
  for (const car of scene.vehicles) {
    if (!near(focus, car.x, car.y)) continue;
    const mesh = kit.cars.acquire(car.id);
    mesh.material = car.wrecked
      ? kit.wreck
      : kit.carColours[car.colour % kit.carColours.length]!;
    mesh.scale.set(lengthOf(car.kind), CAR_HEIGHT_M, widthOf(car.kind));
    mesh.position.set(car.x, CAR_HEIGHT_M / 2, car.y);
    mesh.rotation.set(0, headingToRotationY(car.heading), 0);
  }
}

/**
 * Placeholder people and cars, pooled by entity id: capsules coloured by who they are (you mint,
 * other players orange, pedestrians grey, officers navy) and boxes at each vehicle kind's size,
 * placed from the blended scene every frame.
 *
 * @returns The layer; add its `group` to the scene.
 */
export function createPlaceholderEntities(): PlaceholderEntities {
  const group = new Group();
  const capsule = new CapsuleGeometry(PERSON_RADIUS_M, PERSON_BODY_M);
  const box = new BoxGeometry(1, 1, 1);
  const lambert = (colour: number | string): Material =>
    new MeshLambertMaterial({ color: new Color(colour) });
  const person = {
    local: lambert(LOCAL_PLAYER_MINT),
    other: lambert(OTHER_PLAYER_ORANGE),
    ped: lambert(PED_GREY),
    cop: lambert(COP_NAVY),
  };
  const personPool = (): MeshPool =>
    createMeshPool(group, () => new Mesh(capsule, person.ped));
  const kit: EntityKit = {
    players: personPool(),
    peds: personPool(),
    cops: personPool(),
    cars: createMeshPool(group, () => new Mesh(box, person.ped)),
    person,
    carColours: CAR_BODY_COLOURS.map(lambert),
    wreck: lambert(WRECK_BLACK),
  };
  const pools = [kit.players, kit.peds, kit.cops, kit.cars];
  return {
    group,
    update(scene, focus, options) {
      for (const pool of pools) pool.begin();
      placePeople(kit, scene, focus, options.hideLocalPlayer);
      placeCars(kit, scene, focus);
      for (const pool of pools) pool.end();
    },
    dispose() {
      capsule.dispose();
      box.dispose();
      for (const material of [
        ...Object.values(person),
        ...kit.carColours,
        kit.wreck,
      ])
        material.dispose();
    },
  };
}
