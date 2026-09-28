import {
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Vector3,
} from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cockpit3d } from "./cockpit3d";
import { headingToRotationY } from "./coords";
import {
  VIEW_MODEL_SCALE,
  type ViewModel,
  type ViewModelInput,
} from "./viewmodel";
import {
  VIEW_MODEL_FAR_M,
  VIEW_MODEL_NEAR_M,
  createViewModelPass,
  type CockpitPose,
} from "./viewModelPass";

const HANDS: ViewModelInput = {
  weapon: "pistol",
  firedTick: 40,
  tick: 41,
  speed: 2,
  dt: 1 / 60,
};

function fakeViewModel(): ViewModel & {
  update: ReturnType<typeof vi.fn>;
  muzzleWorld: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    object: new Group(),
    update: vi.fn(),
    muzzleWorld: vi.fn((target: Vector3) => {
      target.set(1, 2, 3);
      return true;
    }),
    dispose: vi.fn(),
  };
}

/** A police car at (12, −8) heading 0.9 rad, siren on. */
const COCKPIT: CockpitPose = {
  kind: "police",
  colour: 0,
  steer: 0.3,
  speedMps: 14,
  siren: true,
  tick: 41,
  dt: 1 / 60,
  x: 12,
  y: -8,
  heading: 0.9,
};

function fakeCockpit(): Cockpit3d & {
  update: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return { object: new Group(), update: vi.fn(), dispose: vi.fn() };
}

function cityCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(70, 16 / 9, 0.1, 1000);
  camera.position.set(12, 1.65, -8);
  camera.lookAt(40, 2, 10);
  return camera;
}

describe("createViewModelPass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("draws nothing while the hands are hidden", () => {
    const viewModel = fakeViewModel();
    const pass = createViewModelPass(() => viewModel);
    expect(pass.update(cityCamera(), null)).toBeNull();
    expect(viewModel.update).not.toHaveBeenCalled();
  });

  it("poses the hands and returns a lit scene seen from the city camera", () => {
    const viewModel = fakeViewModel();
    const pass = createViewModelPass(() => viewModel);
    const city = cityCamera();
    const drawn = pass.update(city, HANDS)!;
    expect(viewModel.update).toHaveBeenCalledWith(HANDS);
    const camera = drawn.camera as PerspectiveCamera;
    expect(viewModel.object.parent).toBe(camera);
    expect(camera.parent).toBe(drawn.scene);
    expect(camera.position.toArray()).toEqual(city.position.toArray());
    expect(camera.quaternion.toArray()).toEqual(city.quaternion.toArray());
    expect(camera.fov).toBe(city.fov);
    expect(camera.aspect).toBe(city.aspect);
    expect(camera.near).toBe(VIEW_MODEL_NEAR_M);
    expect(camera.near).toBeLessThan(city.near);
    const lights = drawn.scene.children.map((child) => child.constructor);
    expect(lights).toContain(HemisphereLight);
    expect(lights).toContain(DirectionalLight);
  });

  it("follows a change of the city camera's field of view and shape", () => {
    const pass = createViewModelPass(fakeViewModel);
    const city = cityCamera();
    pass.update(city, HANDS);
    city.fov = 60;
    city.aspect = 4 / 3;
    city.updateProjectionMatrix();
    const camera = pass.update(city, HANDS)!.camera as PerspectiveCamera;
    expect(camera.fov).toBe(60);
    expect(camera.aspect).toBe(4 / 3);
    expect(camera.projectionMatrix.elements).toEqual(
      new PerspectiveCamera(60, 4 / 3, VIEW_MODEL_NEAR_M, camera.far)
        .projectionMatrix.elements,
    );
  });

  it("sizes the hands and moves them out with a wider screen, keeping their spot on it", () => {
    const viewModel = fakeViewModel();
    const pass = createViewModelPass(() => viewModel);
    const city = cityCamera();
    pass.update(city, HANDS);
    expect(viewModel.object.scale.toArray()).toEqual([
      VIEW_MODEL_SCALE,
      VIEW_MODEL_SCALE,
      VIEW_MODEL_SCALE,
    ]);
    const wide = viewModel.object.position.x;
    city.aspect = 4 / 3;
    city.updateProjectionMatrix();
    pass.update(city, HANDS);
    expect(viewModel.object.position.x).toBeLessThan(wide);
    expect(viewModel.object.position.x).toBeGreaterThan(0);
  });

  it("frees the view model and the cockpit on dispose", () => {
    const viewModel = fakeViewModel();
    const cockpit = fakeCockpit();
    createViewModelPass(
      () => viewModel,
      () => cockpit,
    ).dispose();
    expect(viewModel.dispose).toHaveBeenCalledTimes(1);
    expect(cockpit.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("createViewModelPass: the muzzle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands out the hands' muzzle only in a frame that showed them", () => {
    const viewModel = fakeViewModel();
    const pass = createViewModelPass(() => viewModel, fakeCockpit);
    const target = new Vector3();
    expect(pass.muzzleWorld(target)).toBe(false);
    pass.update(cityCamera(), HANDS);
    expect(pass.muzzleWorld(target)).toBe(true);
    expect(target.toArray()).toEqual([1, 2, 3]);
    pass.update(cityCamera(), HANDS, COCKPIT);
    expect(pass.muzzleWorld(new Vector3())).toBe(false);
    pass.update(cityCamera(), null);
    expect(pass.muzzleWorld(new Vector3())).toBe(false);
  });
});

describe("createViewModelPass: the cockpit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the cockpit where the car stands, turned to its heading, instead of the hands", () => {
    const viewModel = fakeViewModel();
    const cockpit = fakeCockpit();
    const pass = createViewModelPass(
      () => viewModel,
      () => cockpit,
    );
    const drawn = pass.update(cityCamera(), HANDS, COCKPIT)!;
    expect(drawn).not.toBeNull();
    expect(cockpit.object.parent).toBe(drawn.scene);
    expect(cockpit.object.visible).toBe(true);
    expect(cockpit.object.position.toArray()).toEqual([12, 0, -8]);
    expect(cockpit.object.rotation.y).toBe(headingToRotationY(0.9));
    expect(cockpit.update).toHaveBeenCalledWith(COCKPIT);
    expect(viewModel.object.visible).toBe(false);
    expect(viewModel.update).not.toHaveBeenCalled();
  });

  it("shows the cockpit without hands and brings the hands back on foot", () => {
    const viewModel = fakeViewModel();
    const cockpit = fakeCockpit();
    const pass = createViewModelPass(
      () => viewModel,
      () => cockpit,
    );
    expect(pass.update(cityCamera(), null, COCKPIT)).not.toBeNull();
    pass.update(cityCamera(), HANDS, null);
    expect(cockpit.object.visible).toBe(false);
    expect(viewModel.object.visible).toBe(true);
    expect(viewModel.update).toHaveBeenCalledWith(HANDS);
    expect(pass.update(cityCamera(), null, null)).toBeNull();
  });

  it("reaches past the bonnet's nose with its far plane", () => {
    const pass = createViewModelPass(fakeViewModel, fakeCockpit);
    const camera = pass.update(cityCamera(), null, COCKPIT)!
      .camera as PerspectiveCamera;
    expect(camera.far).toBe(VIEW_MODEL_FAR_M);
    expect(VIEW_MODEL_FAR_M).toBeGreaterThanOrEqual(8);
  });
});
