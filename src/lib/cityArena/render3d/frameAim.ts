/**
 * The local player's aim in one 3D frame (aim spec §5): how far the sights are up — eased frame by
 * frame, dropped on a weapon swap — and what the crosshair covers, probed from the placed camera.
 * One object per view, rewritten every frame, so aiming allocates nothing.
 */
import type { PerspectiveCamera } from "three";
import type { Scene } from "../render/renderScene";
import type { WeaponKind } from "../sim/types";
import { WEAPONS } from "../sim/weapons";
import type { DecodedTile } from "../world/decode";
import { probeAim, type AimPoint } from "./aimProbe";
import { createAimWorld, type AimWorldSource } from "./aimWorld";
import {
  easeSights,
  isScoped,
  scopeShare,
  sightsShare,
  type CameraMode,
} from "./cameraRig";
import type { CastAim } from "./cast3d";
import { AIM_PROJECT_DISTANCE_M } from "./coords";
import type { ShooterAim } from "./roundAims";
import type { StructureView } from "./worldCells";

/** What the aim reads from a frame; `View3dFrame` fits. */
export type AimFrame = {
  scene: Scene;
  tiles: readonly DecodedTile[];
  structures: readonly StructureView[];
  mode: CameraMode;
  dt: number;
  deadSeconds: number | null;
  ads?: boolean;
};

/** The aim's state: the probe's world and point, the sights, and what the cast is handed. */
export type FrameAim = {
  world: AimWorldSource;
  point: AimPoint;
  /** False before the first frame and while dead: there is no crosshair then. */
  shown: boolean;
  /** Your shot at the point, handed to the cast while the crosshair shows. */
  shooter: ShooterAim;
  /** Handed to the cast: your shot and how far the sights are up ({@link sightsShare}). */
  cast: CastAim;
  /** The sights' eased progress ({@link easeSights}) and the weapon they belong to. */
  progress: number;
  weapon: WeaponKind;
  /** How much the last frame's sights narrowed the view (`RigPose.zoom`); 1 at the hip. */
  zoom: number;
};

/**
 * A frame aim before its first frame: at the hip, nothing probed.
 *
 * @returns The aim; call {@link raiseSights} and {@link probeFrame} every frame.
 */
export function createFrameAim(): FrameAim {
  return {
    world: createAimWorld(),
    point: { x: 0, y: 0, height: 0, distance: 0, target: "sky" },
    shown: false,
    shooter: { ownerId: 0, x: 0, y: 0, height: 0 },
    cast: { shot: null, sights: 0 },
    progress: 0,
    weapon: "fist",
    zoom: 1,
  };
}

/**
 * The weapon the local player holds.
 *
 * @param scene - The frame's scene.
 * @returns Their weapon; bare fists when they are not in the scene.
 */
export function localWeapon(
  scene: Pick<Scene, "players" | "localPlayerId">,
): WeaponKind {
  for (const player of scene.players)
    if (player.id === scene.localPlayerId) return player.weapon;
  return "fist";
}

/**
 * Eases the sights toward the frame's `ads` (aim spec §5): a weapon swap drops them, a body lowers
 * them, and a weapon without sights never raises them. Call before placing the camera.
 *
 * @param aim - The view's aim.
 * @param frame - The frame.
 * @param weapon - The weapon the local player holds.
 */
export function raiseSights(
  aim: FrameAim,
  frame: AimFrame,
  weapon: WeaponKind,
): void {
  if (weapon !== aim.weapon) {
    aim.weapon = weapon;
    aim.progress = 0;
  }
  const aiming = frame.ads === true && frame.deadSeconds === null;
  aim.progress = easeSights(aim.progress, aiming, weapon, frame.dt);
  aim.cast.sights = sightsShare(aim.progress);
}

/** Hands the cast your shot at the probed point, or none while there is no crosshair. */
function aimCast(aim: FrameAim, scene: Scene): void {
  aim.cast.shot = aim.shown ? aim.shooter : null;
  if (!aim.shown) return;
  aim.shooter.ownerId = scene.localPlayerId;
  aim.shooter.x = aim.point.x;
  aim.shooter.y = aim.point.y;
  aim.shooter.height = aim.point.height;
}

/**
 * Probes what the crosshair covers from the placed camera: within the held weapon's reach past
 * the focus, but never short of where the third-person view converges, so a punch aims where the
 * camera looks rather than at a point beside the shoulder. Nothing while dead.
 *
 * @param aim - The view's aim.
 * @param camera - The placed city camera.
 * @param frame - The frame.
 * @param focus - The local player, or their car, world metres.
 */
export function probeFrame(
  aim: FrameAim,
  camera: PerspectiveCamera,
  frame: AimFrame,
  focus: { x: number; y: number },
): void {
  aim.shown = frame.deadSeconds === null;
  if (aim.shown) {
    aim.world.sync(frame.scene, frame.tiles, frame.structures);
    const reach = Math.max(AIM_PROJECT_DISTANCE_M, WEAPONS[aim.weapon].rangeM);
    probeAim(camera, aim.world, reach, aim.point, focus);
  }
  aimCast(aim, frame.scene);
}

/**
 * How opaque the rifle's scope is this frame: only behind the eyes on foot, fading in over the
 * last of the sights' ease.
 *
 * @param aim - The view's aim, its sights raised for the frame.
 * @param frame - The frame.
 * @param onFoot - Whether the local player is out of a car.
 * @returns The scope's opacity, 0 … 1.
 */
export function scopeOf(
  aim: FrameAim,
  frame: AimFrame,
  onFoot: boolean,
): number {
  if (frame.mode !== "first" || !onFoot || !isScoped(aim.weapon)) return 0;
  return scopeShare(aim.cast.sights);
}
