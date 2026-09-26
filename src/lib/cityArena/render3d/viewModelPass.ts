/**
 * The first-person hands, drawn in a pass of their own over the city (spec §6.3). They hold the
 * weapon a few decimetres from the eye: in the city's depth they would need a near plane far
 * closer than its 0.1 m (costing the whole city depth precision) and would still poke through a
 * wall the player stands against. So they live in a small lit scene of their own, seen through a
 * camera that copies the city camera but clips at 1 cm, and are drawn after the city with the
 * depth buffer cleared — always whole, always on top.
 */
import { PerspectiveCamera, Scene } from "three";
import { createEveningLights, type OverlayPass } from "./renderer3d";
import {
  createViewModel,
  type ViewModel,
  type ViewModelInput,
} from "./viewmodel";

/** The hands' near plane, metres: well inside the forearms' reach toward the eye. */
export const VIEW_MODEL_NEAR_M = 0.01;
/** The hands' far plane, metres: nothing in the pass is farther than an arm's length. */
const VIEW_MODEL_FAR_M = 5;
/** Field of view until the first frame copies the city camera's, degrees. */
const INITIAL_FOV_DEG = 70;

/** The hands' pass. */
export type ViewModelPass = {
  /**
   * Poses the hands for this frame, seen from the city camera.
   *
   * @param camera - The city camera, already placed for this frame.
   * @param input - The weapon, last shot, speed and frame time; `null` hides the hands.
   * @returns The pass to draw over the city, or `null` while the hands are hidden.
   */
  update(
    camera: PerspectiveCamera,
    input: ViewModelInput | null,
  ): OverlayPass | null;
  /** Frees the hands' geometry. */
  dispose(): void;
};

/** Puts the pass camera where the city camera is, with its lens. */
function followCamera(own: PerspectiveCamera, city: PerspectiveCamera): void {
  own.position.copy(city.position);
  own.quaternion.copy(city.quaternion);
  if (own.fov === city.fov && own.aspect === city.aspect) return;
  own.fov = city.fov;
  own.aspect = city.aspect;
  own.updateProjectionMatrix();
}

/**
 * Creates the hands' pass: the view model on a camera of its own, in a scene lit like the city's
 * evening, so the hands shade the same as the bodies around them.
 *
 * @param makeViewModel - Builds the hands; tests pass a fake.
 * @returns The pass; call `update` every frame.
 */
export function createViewModelPass(
  makeViewModel: () => ViewModel = createViewModel,
): ViewModelPass {
  const scene = new Scene();
  const camera = new PerspectiveCamera(
    INITIAL_FOV_DEG,
    1,
    VIEW_MODEL_NEAR_M,
    VIEW_MODEL_FAR_M,
  );
  const viewModel = makeViewModel();
  camera.add(viewModel.object);
  scene.add(...createEveningLights(), camera);
  const pass: OverlayPass = { scene, camera };
  return {
    update(city, input) {
      if (!input) return null;
      followCamera(camera, city);
      viewModel.update(input);
      return pass;
    },
    dispose() {
      viewModel.dispose();
    },
  };
}
