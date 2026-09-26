/**
 * The bright moments of a blast: an additive fireball that swells and fades, a shockwave ring racing
 * over the ground, and a flash of real light (spec §6.8). Real lights are expensive, so at most
 * {@link MAX_FLASH_LIGHTS} exist and are lent out: explosions first, muzzle flashes only when one is
 * spare. The lights stay visible even while dark (intensity 0): three.js keys every lit material's
 * shader on the number of visible lights, so hiding one would recompile them all (Ruling 21). A
 * light lent this frame is not dimmed until the next update, so even a muzzle's 0.05 s flash
 * lights the frame it fires in when frames run longer than that.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  RingGeometry,
  type Vector3Like,
} from "three";
import {
  createFireballMaterial,
  type FireballMaterial,
} from "./fireballMaterial";

/** Colour of an explosion's flash (spec §6.8). */
export const EXPLOSION_LIGHT_COLOUR = 0xffa040;
/** Intensity of an explosion's flash at its start, candela (spec §6.8). */
export const EXPLOSION_LIGHT_INTENSITY = 40;
/** Seconds an explosion's flash takes to die out (spec §6.8). */
export const EXPLOSION_LIGHT_S = 0.25;
/** Most flash lights lit at once (spec §6.8). */
export const MAX_FLASH_LIGHTS = 4;
/** Fireball radius at the blast, metres (spec §6.8). */
export const FIREBALL_START_RADIUS_M = 0.5;
/** Fireball radius when it has burnt out, metres (spec §6.8). */
export const FIREBALL_END_RADIUS_M = 4;
/** Seconds the fireball swells and fades (spec §6.8). */
export const FIREBALL_S = 0.35;
/** Seconds a muzzle flash lights its surroundings (spec §6.8). */
export const MUZZLE_LIGHT_S = 0.05;

/** A muzzle flash is a small warm pop, far below a blast. */
const MUZZLE_LIGHT_INTENSITY = 6;
const MUZZLE_LIGHT_COLOUR = 0xffc070;
/** A flash stops lighting beyond this many metres. */
const EXPLOSION_LIGHT_RANGE_M = 30;
const MUZZLE_LIGHT_RANGE_M = 8;
/** Explosion lights hang this far above the blast, so they light the street around it. */
const EXPLOSION_LIGHT_LIFT_M = 1;
/** Fireballs burning at once; a further blast takes the oldest. */
const FIREBALL_POOL_SIZE = 6;
/** White-hot colour of a fresh fireball, and the deep orange it cools to. */
const FIREBALL_HOT = 0xfff1c4;
const FIREBALL_COOL = 0xff5a14;
/** Fireball opacity at the blast. */
const FIREBALL_PEAK_OPACITY = 0.95;
/** Faceting of the fireball: enough to read as round once it glows. */
const FIREBALL_DETAIL = 2;
/** Hot gas rises: the ball's centre climbs by this share of its radius as it swells. */
const FIREBALL_RISE_SHARE = 0.5;
/** Shockwave ring: seconds to race out, its final radius, colour and opacity at the blast. */
const SHOCKWAVE_S = 0.3;
const SHOCKWAVE_END_RADIUS_M = 7;
const SHOCKWAVE_COLOUR = 0xffc27a;
const SHOCKWAVE_PEAK_OPACITY = 0.6;
/** The ring's band, as the inner edge's share of its radius, and its roundness. */
const SHOCKWAVE_INNER_SHARE = 0.8;
const SHOCKWAVE_SEGMENTS = 40;
/** The ring floats this far above the road so it never fights the ground for depth. */
const SHOCKWAVE_LIFT_M = 0.05;

/** Who a flash light is lent to. */
type LightOwner = "explosion" | "muzzle";

type LightSlot = {
  light: PointLight;
  owner: LightOwner | null;
  age: number;
  duration: number;
  peak: number;
  /** Lent since the last update: that update leaves it at its peak for the frame to draw. */
  fresh: boolean;
};

type FireballSlot = {
  root: Group;
  ball: Mesh;
  ring: Mesh;
  ballMaterial: FireballMaterial;
  ringMaterial: MeshBasicMaterial;
  age: number;
  burning: boolean;
};

/** The fireballs and the lent flash lights. */
export type FlashPool = {
  /** Add to the scene once; holds the fireballs and the flash lights. */
  object: Group;
  /** A blast at a point in three.js space: fireball, shockwave and a flash light. */
  explode(x: number, y: number, z: number): void;
  /** A muzzle flash's light at a point in three.js space, if a light is spare. */
  muzzle(x: number, y: number, z: number): void;
  /** Swells the fireballs and dims the lights; releases what has burnt out. */
  update(dt: number): void;
  /** How many flash lights are lit. */
  litCount(): number;
  /** Frees the geometry and materials; detach `object` yourself. */
  dispose(): void;
};

/** The shockwave's flat additive glow, seen from above and below. */
function ringMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: SHOCKWAVE_COLOUR,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: DoubleSide,
  });
}

function createLightSlot(): LightSlot {
  const light = new PointLight(EXPLOSION_LIGHT_COLOUR, 0);
  light.name = "flash-light";
  return { light, owner: null, age: 0, duration: 1, peak: 0, fresh: false };
}

/** The slot a new flash may take: a dark one, else — for a blast — a muzzle's, else the oldest blast's. */
function lightFor(
  slots: readonly LightSlot[],
  owner: LightOwner,
): LightSlot | null {
  const dark = slots.find((slot) => slot.owner === null);
  if (dark || owner === "muzzle") return dark ?? null;
  const muzzle = slots.find((slot) => slot.owner === "muzzle");
  if (muzzle) return muzzle;
  return slots.reduce((oldest, slot) =>
    slot.age > oldest.age ? slot : oldest,
  );
}

/** Lights a slot's lamp for a blast or a muzzle flash at a point in three.js space. */
function lend(slot: LightSlot, owner: LightOwner, at: Vector3Like): void {
  const blast = owner === "explosion";
  slot.owner = owner;
  slot.age = 0;
  slot.fresh = true;
  slot.duration = blast ? EXPLOSION_LIGHT_S : MUZZLE_LIGHT_S;
  slot.peak = blast ? EXPLOSION_LIGHT_INTENSITY : MUZZLE_LIGHT_INTENSITY;
  slot.light.color.setHex(blast ? EXPLOSION_LIGHT_COLOUR : MUZZLE_LIGHT_COLOUR);
  slot.light.distance = blast ? EXPLOSION_LIGHT_RANGE_M : MUZZLE_LIGHT_RANGE_M;
  slot.light.intensity = slot.peak;
  slot.light.position.set(at.x, at.y, at.z);
}

/**
 * Dims a lit flash along (1 − t)², and hands the light back once it is dark; a light lent since
 * the last update keeps its peak for this frame.
 */
function dim(slot: LightSlot, dt: number): void {
  if (slot.owner === null) return;
  if (slot.fresh) {
    slot.fresh = false;
    return;
  }
  slot.age += dt;
  const t = slot.age / slot.duration;
  if (t >= 1) {
    slot.owner = null;
    slot.light.intensity = 0;
    return;
  }
  slot.light.intensity = slot.peak * (1 - t) * (1 - t);
}

function createFireballSlot(
  ballGeometry: IcosahedronGeometry,
  ringGeometry: RingGeometry,
): FireballSlot {
  const ballMaterial = createFireballMaterial(FIREBALL_HOT);
  const waveMaterial = ringMaterial();
  const ball = new Mesh(ballGeometry, ballMaterial);
  ball.name = "fireball";
  const ring = new Mesh(ringGeometry, waveMaterial);
  ring.name = "shockwave";
  const root = new Group();
  root.add(ball, ring);
  root.visible = false;
  return {
    root,
    ball,
    ring,
    ballMaterial,
    ringMaterial: waveMaterial,
    age: 0,
    burning: false,
  };
}

/** A flat unit ring lying on the ground, facing up. */
function createRingGeometry(): RingGeometry {
  const geometry = new RingGeometry(
    SHOCKWAVE_INNER_SHARE,
    1,
    SHOCKWAVE_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** The fireball to light next: an idle one, else the one burning longest. */
function fireballFor(slots: readonly FireballSlot[]): FireballSlot {
  return (
    slots.find((slot) => !slot.burning) ??
    slots.reduce((oldest, slot) => (slot.age > oldest.age ? slot : oldest))
  );
}

function ignite(slot: FireballSlot, x: number, y: number, z: number): void {
  slot.burning = true;
  slot.age = 0;
  slot.root.visible = true;
  slot.root.position.set(x, y, z);
  slot.ring.position.y = SHOCKWAVE_LIFT_M - y;
  shapeFireball(slot);
}

const hot = new Color(FIREBALL_HOT);
const cool = new Color(FIREBALL_COOL);

/** Poses a burning fireball and its shockwave for its age. */
function shapeFireball(slot: FireballSlot): void {
  const t = Math.min(1, slot.age / FIREBALL_S);
  const swell = 1 - (1 - t) ** 3;
  const radius =
    FIREBALL_START_RADIUS_M +
    (FIREBALL_END_RADIUS_M - FIREBALL_START_RADIUS_M) * swell;
  slot.ball.scale.setScalar(radius);
  slot.ball.position.y =
    (radius - FIREBALL_START_RADIUS_M) * FIREBALL_RISE_SHARE;
  const glow = slot.ballMaterial.uniforms;
  glow.uOpacity.value = FIREBALL_PEAK_OPACITY * (1 - t);
  glow.uColour.value.lerpColors(hot, cool, t);
  const wave = Math.min(1, slot.age / SHOCKWAVE_S);
  slot.ring.visible = wave < 1;
  slot.ring.scale.setScalar(
    1 + (SHOCKWAVE_END_RADIUS_M - 1) * (1 - (1 - wave) ** 2),
  );
  slot.ringMaterial.opacity = SHOCKWAVE_PEAK_OPACITY * (1 - wave);
}

function burn(slot: FireballSlot, dt: number): void {
  if (!slot.burning) return;
  slot.age += dt;
  if (slot.age >= FIREBALL_S) {
    slot.burning = false;
    slot.root.visible = false;
    return;
  }
  shapeFireball(slot);
}

/**
 * Creates the fireball pool and the {@link MAX_FLASH_LIGHTS} flash lights. The lights stay in the
 * scene and visible at all times; a dark one just has intensity 0.
 *
 * @returns The pool; add `object` to the scene and call `update` once per frame.
 */
export function createFlashPool(): FlashPool {
  const ballGeometry = new IcosahedronGeometry(1, FIREBALL_DETAIL);
  const ringGeometry = createRingGeometry();
  const lights = Array.from({ length: MAX_FLASH_LIGHTS }, createLightSlot);
  const fireballs = Array.from({ length: FIREBALL_POOL_SIZE }, () =>
    createFireballSlot(ballGeometry, ringGeometry),
  );
  const object = new Group();
  object.name = "flashes";
  // Drawn after the smoke, so a fireball glows over the smoke swelling inside it.
  object.renderOrder = 1;
  for (const slot of lights) object.add(slot.light);
  for (const slot of fireballs) object.add(slot.root);
  return {
    object,
    explode(x, y, z) {
      ignite(fireballFor(fireballs), x, y, z);
      const slot = lightFor(lights, "explosion");
      if (slot)
        lend(slot, "explosion", { x, y: y + EXPLOSION_LIGHT_LIFT_M, z });
    },
    muzzle(x, y, z) {
      const slot = lightFor(lights, "muzzle");
      if (slot) lend(slot, "muzzle", { x, y, z });
    },
    update(dt) {
      for (const slot of lights) dim(slot, dt);
      for (const slot of fireballs) burn(slot, dt);
    },
    litCount: () => lights.reduce((lit, slot) => lit + (slot.owner ? 1 : 0), 0),
    dispose() {
      ballGeometry.dispose();
      ringGeometry.dispose();
      for (const slot of fireballs) {
        slot.ballMaterial.dispose();
        slot.ringMaterial.dispose();
      }
      for (const slot of lights) slot.light.dispose();
    },
  };
}
