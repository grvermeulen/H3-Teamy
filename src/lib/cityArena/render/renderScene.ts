import type {
  ArenaPlayerState,
  BulletState,
  CopState,
  EffectState,
  PedState,
  PickupState,
  VehicleState,
} from "../sim/types";
import type { MapZone } from "../world/mapTypes";
import type { Camera, Viewport } from "./camera";
import type { RasterContext } from "./canvasTypes";
import {
  DEAD_PLAYER_STYLE,
  DEFAULT_PLAYER_STYLE,
  OTHER_PLAYER_STYLE,
  drawPlayer,
  drawZoneRing,
  playerLook,
} from "./drawEntities";
import { drawBullets, drawCrosshair, drawEffects } from "./drawProjectiles";
import { drawPeople } from "./drawPeople";
import { drawPickups } from "./drawPickups";
import { drawVehicles } from "./drawVehicles";
import {
  drawOverheadChunks,
  drawVisibleChunks,
  type DrawStats,
  type WorldDrawSource,
} from "./drawWorld";
import {
  itemKeyForWeapon,
  itemSpriteFor,
  type ItemSprites,
  type PersonSprite,
  type PersonSprites,
  type VehicleArt,
} from "./sprites";

/** A rectangle of the canvas (CSS px) rendered through one camera — several of these make a split screen. */
export type SceneViewport = {
  rect: { x: number; y: number; width: number; height: number };
  camera: Camera;
};

/** Everything drawn for one viewport; `pushIn` (1 = none) zooms around the centre for the death screen. */
export type Scene = {
  world: WorldDrawSource;
  zone: MapZone | null;
  /** Every player in the match; the one whose id is `localPlayerId` is this client's own. */
  players: ArenaPlayerState[];
  /** Which of `players` this client drives, and therefore draws in its own colours. */
  localPlayerId: number;
  peds: PedState[];
  cops: CopState[];
  pickups: PickupState[];
  vehicles: VehicleState[];
  bullets: BulletState[];
  effects: EffectState[];
  /** Cars the police are driving: their lights flash, and near this player the siren sounds. */
  sirenVehicleIds?: ReadonlySet<number>;
  tick: number;
  aimScreen: [number, number] | null;
  pushIn: number;
  /** Screen shake for this frame, in pixels; absent or zero draws the scene where it is. */
  shake?: { x: number; y: number };
  /** Car sprite, absent until its art has loaded — cars fall back to the vector body. */
  /** The vehicle art: every kind's sprite, and the sedan's for the kinds without one. */
  vehicleArt?: VehicleArt;
  /** The pedestrians' and officers' strips by look. */
  peopleSprites?: PersonSprites;
  /** Pickup icons and the weapons in hands, absent until the art has loaded. */
  itemSprites?: ItemSprites;
  /** Player character art, absent until it has loaded — the player falls back to the circle. */
  playerSprite?: PersonSprite;
};

/** Scales the viewport around its centre by `pushIn`. */
function applyPushIn(
  context: RasterContext,
  size: Viewport,
  pushIn: number,
): void {
  if (pushIn === 1) return;
  context.translate(size.width / 2, size.height / 2);
  context.scale(pushIn, pushIn);
  context.translate(-size.width / 2, -size.height / 2);
}

/** The car this client sits in, so the vehicle painter can mark it. */
function localVehicleId(scene: Scene): number | null {
  return (
    scene.players.find((player) => player.id === scene.localPlayerId)
      ?.vehicleId ?? null
  );
}

/** Draws every player, skipping the ones hidden in a car or in the off half of a shield blink. */
function drawPlayerLook(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  scene: Scene,
): void {
  // Everyone else first, so your own player is never hidden under somebody standing on you.
  const order = [...scene.players].sort(
    (first, second) =>
      Number(first.id === scene.localPlayerId) -
      Number(second.id === scene.localPlayerId),
  );
  for (const player of order) {
    const look = playerLook(player, scene.tick);
    if (look === "hidden" || look === "blink") continue;
    const dead = look === "dead";
    const style = dead
      ? DEAD_PLAYER_STYLE
      : player.id === scene.localPlayerId
        ? DEFAULT_PLAYER_STYLE
        : OTHER_PLAYER_STYLE;
    // A body keeps the flat dead marker: the character art is of someone standing up.
    drawPlayer(
      context,
      camera,
      size,
      player,
      style,
      dead ? undefined : scene.playerSprite,
      scene.tick,
      dead
        ? undefined
        : itemSpriteFor(scene.itemSprites, itemKeyForWeapon(player.weapon)),
    );
  }
}

/**
 * Renders one viewport: clips to its rect, translates into its local space, applies the push-in,
 * then draws world chunks → zone ring → cars → bullets → effects → player → tree canopies →
 * crosshair and restores.
 */
export function renderScene(
  context: RasterContext,
  viewport: SceneViewport,
  scene: Scene,
): DrawStats {
  const { rect, camera } = viewport;
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  context.translate(rect.x, rect.y);
  const size = { width: rect.width, height: rect.height };
  applyPushIn(context, size, scene.pushIn);
  // The world shakes; the crosshair, drawn after the restore below, stays on the cursor.
  if (scene.shake) {
    context.save();
    context.translate(scene.shake.x, scene.shake.y);
  }
  const stats = drawVisibleChunks(context, camera, size, scene.world);
  if (scene.zone) drawZoneRing(context, camera, size, scene.zone);
  drawPickups(
    context,
    camera,
    size,
    scene.pickups,
    scene.tick,
    scene.itemSprites,
  );
  drawVehicles(
    context,
    camera,
    size,
    scene.vehicles,
    scene.tick,
    localVehicleId(scene),
    scene.vehicleArt,
    scene.sirenVehicleIds,
  );
  drawPeople(
    context,
    camera,
    size,
    scene.peds,
    scene.cops,
    scene.peopleSprites,
    scene.tick,
    scene.itemSprites,
  );
  drawBullets(context, camera, size, scene.bullets);
  drawEffects(context, camera, size, scene.effects, scene.tick);
  drawPlayerLook(context, camera, size, scene);
  const overheadRasterised = drawOverheadChunks(
    context,
    camera,
    size,
    scene.world,
  );
  if (scene.shake) context.restore();
  if (scene.aimScreen) drawCrosshair(context, scene.aimScreen);
  context.restore();
  return {
    missing: stats.missing,
    rasterised: stats.rasterised || overheadRasterised,
  };
}
