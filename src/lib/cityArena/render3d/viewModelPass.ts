/**
 * The first-person hands — or, at the wheel, the cockpit — drawn in a pass of their own over the
 * city (spec §6.3, immersion spec §4). The hands hold the weapon a few decimetres from the eye: in
 * the city's depth they would need a near plane far closer than its 0.1 m (costing the whole city
 * depth precision) and would still poke through a wall the player stands against. So they live in
 * a small lit scene of their own, seen through a camera that copies the city camera but clips at
 * 1 cm, and are drawn after the city with the depth buffer cleared — always whole, always on top.
 * The hands are sized and placed for the camera's lens every frame, so they keep their corner of
 * the screen on any screen shape. They keep a lens of their own ({@link HANDS_FOV_DEG}) while the
 * sights zoom the city (aim spec §5), as shooters draw their view models, so the gun in your hands
 * does not swell with the zoom. The cockpit stands in the same scene where the car is in the
 * world: the pass camera sits exactly where the city camera does, so the car's frame lines up.
 */
import { PerspectiveCamera, Scene, type Vector3 } from "three";
import {
  createCockpit3d,
  type Cockpit3d,
  type CockpitInput,
} from "./cockpit3d";
import { headingToRotationY, setWorldPosition } from "./coords";
import { createEveningLights, type OverlayPass } from "./renderer3d";
import {
  createViewModel,
  placeViewModel,
  type ViewModel,
  type ViewModelInput,
} from "./viewmodel";

/** The hands' near plane, metres: well inside the forearms' reach toward the eye. */
export const VIEW_MODEL_NEAR_M = 0.01;
/** The pass's far plane, metres: beyond a car's nose seen from the driver's seat. */
export const VIEW_MODEL_FAR_M = 8;
/** The hands' own field of view, degrees: the first-person view's at the hip. */
export const HANDS_FOV_DEG = 70;
/** Degrees to radians, halved: a field of view's half angle. */
const HALF_ANGLE_PER_DEGREE = Math.PI / 360;

/** The car the cockpit belongs to: what it shows, and where the car stands in the world. */
export type CockpitPose = CockpitInput & {
  /** World metres. */
  x: number;
  y: number;
  /** World heading, radians. */
  heading: number;
};

/** The hands' and cockpit's pass. */
export type ViewModelPass = {
  /**
   * Poses the hands, or the cockpit, for this frame, seen from the city camera.
   *
   * @param camera - The city camera, already placed for this frame.
   * @param input - The weapon, last shot, speed and frame time; `null` hides the hands.
   * @param cockpit - The car driven in first person; it shows instead of the hands.
   * @returns The pass to draw over the city, or `null` while neither shows.
   */
  update(
    camera: PerspectiveCamera,
    input: ViewModelInput | null,
    cockpit?: CockpitPose | null,
  ): OverlayPass | null;
  /**
   * Where the drawn gun ends in the world this frame — the hands', or at the wheel the cockpit's
   * gun hand during a drive-by: the pass camera stands exactly where the city camera does, so the
   * point lines up with the drawn gun in the city too.
   *
   * @param target - Receives the world position; untouched when there is none.
   * @returns `false` unless the last `update` showed the hands or the cockpit holding a gun.
   */
  muzzleWorld(target: Vector3): boolean;
  /** Frees the hands' geometry and detaches the cockpit. */
  dispose(): void;
};

/** Puts the pass camera where the city camera is, with the city's shape and `fovDeg`. */
function followCamera(
  own: PerspectiveCamera,
  city: PerspectiveCamera,
  fovDeg: number,
): void {
  own.position.copy(city.position);
  own.quaternion.copy(city.quaternion);
  if (own.fov === fovDeg && own.aspect === city.aspect) return;
  own.fov = fovDeg;
  own.aspect = city.aspect;
  own.updateProjectionMatrix();
}

/**
 * Moves a point the hands' lens draws to where the city camera, zoomed by the sights, draws the
 * same pixel, keeping its depth — so your rounds leave the barrel you see.
 */
function toCityLens(
  point: Vector3,
  own: PerspectiveCamera,
  cityFovDeg: number,
): void {
  const share =
    Math.tan(cityFovDeg * HALF_ANGLE_PER_DEGREE) /
    Math.tan(own.fov * HALF_ANGLE_PER_DEGREE);
  if (share === 1) return;
  own.worldToLocal(point);
  point.x *= share;
  point.y *= share;
  own.localToWorld(point);
}

/** Stands the cockpit where the car is in the world, turned to its heading, and poses it. */
function placeCockpit(cockpit: Cockpit3d, pose: CockpitPose): void {
  setWorldPosition(cockpit.object.position, pose.x, pose.y);
  cockpit.object.rotation.y = headingToRotationY(pose.heading);
  cockpit.update(pose);
}

/**
 * Creates the pass: the view model on a camera of its own and the cockpit, in a scene lit like the
 * city's evening, so hands and dashboard shade the same as the bodies around them.
 *
 * @param makeViewModel - Builds the hands; tests pass a fake.
 * @param makeCockpit - Builds the cockpit; tests pass a fake.
 * @returns The pass; call `update` every frame.
 */
export function createViewModelPass(
  makeViewModel: () => ViewModel = createViewModel,
  makeCockpit: () => Cockpit3d = createCockpit3d,
): ViewModelPass {
  const scene = new Scene();
  const camera = new PerspectiveCamera(
    HANDS_FOV_DEG,
    1,
    VIEW_MODEL_NEAR_M,
    VIEW_MODEL_FAR_M,
  );
  const viewModel = makeViewModel();
  const cockpit = makeCockpit();
  camera.add(viewModel.object);
  scene.add(...createEveningLights(), camera, cockpit.object);
  const pass: OverlayPass = { scene, camera };
  let handsShown = false;
  let cockpitShown = false;
  let cityFovDeg = HANDS_FOV_DEG;
  return {
    update(city, input, pose = null) {
      handsShown = input !== null && !pose;
      cockpitShown = pose !== null;
      if (!input && !pose) return null;
      cityFovDeg = city.fov;
      followCamera(camera, city, pose ? city.fov : HANDS_FOV_DEG);
      viewModel.object.visible = !pose;
      cockpit.object.visible = pose !== null;
      if (pose) {
        placeCockpit(cockpit, pose);
        return pass;
      }
      placeViewModel(viewModel.object, camera, input?.sights);
      if (input) viewModel.update(input);
      return pass;
    },
    muzzleWorld(target) {
      // The cockpit is drawn through the city's own lens; only the hands keep a lens of their own.
      if (!handsShown) return cockpitShown && cockpit.muzzleWorld(target);
      if (!viewModel.muzzleWorld(target)) return false;
      toCityLens(target, camera, cityFovDeg);
      return true;
    },
    dispose() {
      viewModel.dispose();
      cockpit.dispose();
    },
  };
}
