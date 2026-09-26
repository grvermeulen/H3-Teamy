import {
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
} from "three";
import { describe, expect, it, vi } from "vitest";
import {
  VIEW_MODEL_SCALE,
  type ViewModel,
  type ViewModelInput,
} from "./viewmodel";
import { VIEW_MODEL_NEAR_M, createViewModelPass } from "./viewModelPass";

const HANDS: ViewModelInput = {
  weapon: "pistol",
  firedTick: 40,
  tick: 41,
  speed: 2,
  dt: 1 / 60,
};

function fakeViewModel(): ViewModel & {
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

  it("frees the view model on dispose", () => {
    const viewModel = fakeViewModel();
    createViewModelPass(() => viewModel).dispose();
    expect(viewModel.dispose).toHaveBeenCalledTimes(1);
  });
});
