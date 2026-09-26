import { Scene } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene as ArenaScene } from "../render/renderScene";
import { createEffects3d } from "./effects3d";
import { createEntitySync } from "./entities";
import { createView3d, type View3dFrame } from "./index";
import { createRenderer3d } from "./renderer3d";

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

vi.mock("./entities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./entities")>();
  const three = await import("three");
  return {
    ...actual,
    createEntitySync: vi.fn(() => ({
      group: new three.Group(),
      local: { onFoot: true, weapon: "pistol", firedTick: null, speed: 0 },
      update: vi.fn(),
      dispose: vi.fn(),
    })),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

const DT = 1 / 60;
const OVERLAY = {} as CanvasRenderingContext2D;
const SCENE = {
  localPlayerId: 2,
  players: [{ id: 2, x: 5, y: 6, vehicleId: null }],
  vehicles: [],
} as unknown as ArenaScene;

function frameOf(mode: View3dFrame["mode"]): View3dFrame {
  return {
    scene: SCENE,
    tiles: [],
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
} {
  return {
    renderer: vi.mocked(createRenderer3d).mock.results[0]!.value,
    sync: vi.mocked(createEntitySync).mock.results[0]!.value,
  };
}

describe("createView3d frame path", () => {
  it("syncs the cast and the effects every frame and renders the city", () => {
    const view = createView3d(document.createElement("canvas"));
    const { renderer, sync } = partsOfView();
    let root = sync.group.parent;
    while (root?.parent) root = root.parent;
    expect(root).toBe(renderer.scene);
    view.render(frameOf("third"), OVERLAY);
    const focus = expect.objectContaining({ x: 5, y: 6 });
    expect(sync.update).toHaveBeenCalledWith(SCENE, DT, focus, {
      firstPerson: false,
      aim: 0.7,
    });
    const effects = vi.mocked(createEffects3d).mock.results[0]!.value;
    expect(effects.sync).toHaveBeenCalledWith(SCENE, focus);
    expect(effects.update).toHaveBeenCalledWith(DT);
    expect(renderer.render).toHaveBeenCalledWith(null);
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

  it("frees the cast, the effects and the renderer on dispose", () => {
    const view = createView3d(document.createElement("canvas"));
    const { renderer, sync } = partsOfView();
    view.render(frameOf("third"), OVERLAY);
    view.dispose();
    const effects = vi.mocked(createEffects3d).mock.results[0]!.value;
    expect(sync.dispose).toHaveBeenCalledTimes(1);
    expect(effects.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });
});
