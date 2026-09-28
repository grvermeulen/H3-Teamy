import {
  Mesh,
  Scene,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene as ArenaScene } from "../render/renderScene";
import type { EffectState, VehicleState } from "../sim/types";
import { createVehicle } from "../sim/vehicle";
import { structureIdOf } from "../world/structureId";
import { characterMaterials } from "./characterRig";
import { createCity3d } from "./city3d";
import { createDestruction3d } from "./destruction3d";
import { createEffects3d } from "./effects3d";
import { createEntitySync } from "./entities";
import { FACADE_BLOCK_ATTRIBUTE } from "./facadeAtlas";
import { createView3d, type StructureView, type View3dFrame } from "./index";
import { drawOverlay3d } from "./overlay3d";
import { createRenderer3d } from "./renderer3d";
import { ruinOf } from "./ruins3d";
import { fixtureTown } from "./testing/cityFixture";

vi.mock("./renderer3d", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./renderer3d")>();
  const three = await import("three");
  return {
    ...actual,
    createRenderer3d: vi.fn(() => ({
      scene: new three.Scene(),
      camera: new three.PerspectiveCamera(),
      configure: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    })),
  };
});

vi.mock("./overlay3d", () => ({ drawOverlay3d: vi.fn() }));

vi.mock("./effects3d", async () => {
  const three = await import("three");
  return {
    createEffects3d: vi.fn(() => ({
      object: new three.Group(),
      smoke: {},
      sync: vi.fn(),
      update: vi.fn(),
      dispose: vi.fn(),
    })),
  };
});

vi.mock("./destruction3d", async () => {
  const three = await import("three");
  return {
    createDestruction3d: vi.fn(() => ({
      object: new three.Group(),
      collapse: vi.fn(),
      setRubble: vi.fn(),
      knockOver: vi.fn(),
      update: vi.fn(),
      dispose: vi.fn(),
    })),
  };
});

vi.mock("./entities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./entities")>();
  const three = await import("three");
  const { createMuzzleMap } = await import("./muzzleMap");
  return {
    ...actual,
    createEntitySync: vi.fn(() => ({
      group: new three.Group(),
      muzzles: createMuzzleMap(),
      local: {
        onFoot: true,
        weapon: "pistol",
        firedTick: null,
        speed: 0,
        vehicle: null,
      },
      update: vi.fn(),
      dispose: vi.fn(),
    })),
  };
});

// The real city with textureless materials: jsdom has no canvas for the façades.
vi.mock("./city3d", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./city3d")>();
  const { createTestMaterials } = await import("./testing/cityFixture");
  return {
    ...actual,
    createCity3d: vi.fn(() => actual.createCity3d(createTestMaterials())),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

const DT = 1 / 60;
const TICK = 500;
const OVERLAY = {} as CanvasRenderingContext2D;
/** The fixture town's house, a 10 m square at (20, 72) on tile (1, 1). */
const HOUSE = structureIdOf(1, 1, 0);
const TOWN = fixtureTown();
/** The world session's landmark lookup: one map for the life of a session. */
const LANDMARKS = new Map();

function sceneOf(
  vehicles: VehicleState[] = [],
  effects: EffectState[] = [],
): ArenaScene {
  return {
    localPlayerId: 2,
    players: [
      {
        id: 2,
        x: 25,
        y: 60,
        vehicleId: null,
        diedAtTick: null,
        weapon: "pistol",
      },
    ],
    peds: [],
    cops: [],
    vehicles,
    effects,
    tick: TICK,
    world: { landmarks: LANDMARKS },
  } as unknown as ArenaScene;
}

const SCENE = sceneOf();

function frameOf(
  mode: View3dFrame["mode"],
  extra: Partial<View3dFrame> = {},
): View3dFrame {
  return {
    scene: SCENE,
    tiles: [TOWN],
    structures: [],
    yaw: 0.7,
    pitch: 0,
    aim: 0.7,
    mode,
    dt: DT,
    nowMs: 1000,
    deadSeconds: null,
    quality: "auto",
    size: { width: 800, height: 450 },
    ...extra,
  };
}

/** The mocked parts behind the one view the test created. */
function partsOfView(): {
  renderer: ReturnType<typeof createRenderer3d> & {
    render: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  sync: ReturnType<typeof createEntitySync> & {
    update: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  city: ReturnType<typeof createCity3d>;
} {
  return {
    renderer: vi.mocked(createRenderer3d).mock.results[0]!.value,
    sync: vi.mocked(createEntitySync).mock.results[0]!.value,
    city: vi.mocked(createCity3d).mock.results[0]!.value,
  };
}

/** The destruction the view's cast made, with its recorded calls. */
function destructionOfView(): Record<
  "collapse" | "setRubble" | "knockOver",
  ReturnType<typeof vi.fn>
> {
  return vi.mocked(createDestruction3d).mock.results[0]!.value;
}

/**
 * Wall vertices standing in the city's cell (0, 0), where the fixture's house is: the merged walls
 * mesh is the one carrying façade blocks.
 */
function homeWallVertices(city: Object3D): number {
  let count = 0;
  city.traverse((node) => {
    const home = node.parent?.parent === city && node.position.lengthSq() === 0;
    if (!home) return;
    for (const part of node.children)
      if (
        part instanceof Mesh &&
        part.geometry.getAttribute(FACADE_BLOCK_ATTRIBUTE) !== undefined
      )
        count += (part.geometry as BufferGeometry).getAttribute(
          "position",
        ).count;
  });
  return count;
}

describe("createView3d frame path", () => {
  it("syncs the cast and the effects every frame and renders the city", () => {
    const view = createView3d(document.createElement("canvas"));
    const { renderer, sync, city } = partsOfView();
    let root = sync.group.parent;
    while (root?.parent) root = root.parent;
    expect(root).toBe(renderer.scene);
    expect(city.object.parent).toBe(renderer.scene);
    view.render(frameOf("third"), OVERLAY);
    const focus = expect.objectContaining({ x: 25, y: 60 });
    expect(sync.update).toHaveBeenCalledWith(SCENE, DT, focus, {
      firstPerson: false,
      aim: 0.7,
    });
    const effects = vi.mocked(createEffects3d).mock.results[0]!.value;
    expect(effects.sync).toHaveBeenCalledWith(
      SCENE,
      focus,
      false,
      expect.any(Map),
    );
    expect(effects.update).toHaveBeenCalledWith(DT);
    expect(renderer.render).toHaveBeenCalledWith(null);
  });

  it("streams the real city around the focus, dressed by the scene's landmarks", () => {
    const view = createView3d(document.createElement("canvas"));
    const { city } = partsOfView();

    view.render(frameOf("third"), OVERLAY);

    expect(homeWallVertices(city.object)).toBeGreaterThan(0);
    expect(city.furnitureNear(30, 58, 2).map((piece) => piece.kind)).toEqual([
      "bench",
    ]);
  });

  it("drops a building that just fell from the city in the frame its collapse starts", () => {
    const view = createView3d(document.createElement("canvas"));
    const { city } = partsOfView();
    view.render(frameOf("third"), OVERLAY);
    const standing = homeWallVertices(city.object);
    const fell: StructureView = {
      id: HOUSE,
      damage: 999,
      destroyedAtTick: TICK - 1,
    };

    view.render(frameOf("third", { structures: [fell] }), OVERLAY);

    const destruction = destructionOfView();
    expect(destruction.collapse).toHaveBeenCalledWith(ruinOf(HOUSE, [TOWN]));
    expect(destruction.setRubble).toHaveBeenLastCalledWith([
      ruinOf(HOUSE, [TOWN]),
    ]);
    expect(homeWallVertices(city.object)).toBeLessThan(standing);
  });

  it("knocks over the furniture a fast car sweeps past", () => {
    const view = createView3d(document.createElement("canvas"));
    view.render(frameOf("third"), OVERLAY);
    const { city } = partsOfView();
    const [bench] = city.furnitureNear(30, 58, 1);
    const car = createVehicle(9, "sedan", [30, 57], 0, 0);
    car.velocityX = 10;

    view.render(frameOf("third", { scene: sceneOf([car]) }), OVERLAY);

    expect(destructionOfView().knockOver).toHaveBeenCalledWith(
      bench!.object,
      30,
      57,
    );
    expect(city.furnitureNear(30, 58, 1)).toEqual([]);
  });

  it("knocks over the rebuilt cell's bench when a blast brings a building in its cell down", () => {
    const view = createView3d(document.createElement("canvas"));
    const { city } = partsOfView();
    view.render(frameOf("third"), OVERLAY);
    const [before] = city.furnitureNear(30, 58, 1);
    const blast: EffectState = {
      id: 7,
      kind: "explosion",
      x: 30,
      y: 60,
      angle: 0,
      bornTick: TICK,
      ttlTicks: 20,
    };
    const fell: StructureView = {
      id: HOUSE,
      damage: 999,
      destroyedAtTick: TICK,
    };

    view.render(
      frameOf("third", { scene: sceneOf([], [blast]), structures: [fell] }),
      OVERLAY,
    );

    const { knockOver } = destructionOfView();
    expect(knockOver).toHaveBeenCalledTimes(1);
    const [knocked] = knockOver.mock.calls[0] as [Object3D];
    expect(knocked).not.toBe(before!.object);
    expect([knocked.position.x, knocked.position.z]).toEqual([30, 58]);
  });

  it("guides the way: the route on the road, and arrows toward friends on the HUD", () => {
    const view = createView3d(document.createElement("canvas"));
    const { renderer } = partsOfView();
    const friend = { id: 7, x: 300, y: 60, vehicleId: null, diedAtTick: null };
    const scene = {
      ...SCENE,
      players: [...SCENE.players, friend],
      navigation: [
        [25, 60],
        [80, 60],
      ],
    } as unknown as ArenaScene;

    view.render(frameOf("third", { scene }), OVERLAY);

    const route = renderer.scene.getObjectByName("route")!;
    expect(route.visible).toBe(true);
    expect(renderer.scene.getObjectByName("guidance")).toBe(route.parent);
    expect(drawOverlay3d).toHaveBeenCalledWith(
      OVERLAY,
      renderer.camera,
      expect.objectContaining({ friends: scene }),
    );
  });

  it("probes what the crosshair covers: the house ahead, and nothing while dead", () => {
    const view = createView3d(document.createElement("canvas"));
    expect(view.aimPoint()).toBeNull();

    view.render(frameOf("third", { yaw: Math.PI / 2 }), OVERLAY);

    expect(view.aimPoint()).toMatchObject({ target: "building" });
    expect(view.aimPoint()!.y).toBeCloseTo(72, 6);
    view.render(frameOf("third", { deadSeconds: 1 }), OVERLAY);
    expect(view.aimPoint()).toBeNull();
  });

  it("draws the first-person hands in a pass of their own over the city", () => {
    const view = createView3d(document.createElement("canvas"));
    const { renderer, sync } = partsOfView();
    view.render(frameOf("first"), OVERLAY);
    expect(sync.update.mock.lastCall?.[3]).toEqual({
      firstPerson: true,
      aim: 0.7,
    });
    const [pass] = renderer.render.mock.lastCall!;
    expect(pass.scene).toBeInstanceOf(Scene);
    expect(pass.scene).not.toBe(renderer.scene);
  });

  it("frees the WebGL context when a layer fails to start, and passes the error on", () => {
    const failure = new Error("no 2D canvas for the façades");
    vi.mocked(createCity3d).mockImplementationOnce(() => {
      throw failure;
    });

    expect(() => createView3d(document.createElement("canvas"))).toThrow(
      failure,
    );

    const renderer = vi.mocked(createRenderer3d).mock.results[0]!.value;
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it("frees the shared character, vehicle, pickup and weapon assets before the renderer", () => {
    const view = createView3d(document.createElement("canvas"));
    const { renderer } = partsOfView();
    const shared = characterMaterials().body;
    const freeShared = vi.spyOn(shared, "dispose");
    view.dispose();
    expect(freeShared).toHaveBeenCalledTimes(1);
    expect(freeShared.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(renderer.dispose).mock.invocationCallOrder[0]!,
    );
    expect(characterMaterials().body).not.toBe(shared);
  });

  it("frees the city, the cast, the effects, the guidance and the renderer on dispose", () => {
    const view = createView3d(document.createElement("canvas"));
    const { renderer, sync, city } = partsOfView();
    const freeCity = vi.spyOn(city, "dispose");
    view.render(frameOf("third"), OVERLAY);
    const guidance = renderer.scene.getObjectByName("guidance")!;
    const freeGuidance: ReturnType<typeof vi.spyOn>[] = [];
    guidance.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      freeGuidance.push(vi.spyOn(node.geometry as BufferGeometry, "dispose"));
      freeGuidance.push(vi.spyOn(node.material as Material, "dispose"));
    });
    view.dispose();
    const effects = vi.mocked(createEffects3d).mock.results[0]!.value;
    expect(freeCity).toHaveBeenCalledTimes(1);
    expect(sync.dispose).toHaveBeenCalledTimes(1);
    expect(effects.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(freeGuidance.length).toBeGreaterThanOrEqual(4);
    for (const free of freeGuidance) expect(free).toHaveBeenCalledTimes(1);
  });
});
