/**
 * The night over the evening sky: a field of stars that fades out toward the horizon's glow, and
 * the moon, a pale disc with a soft halo in the moonlight's quarter of the sky. Both hang inside
 * the sky dome and travel with it (the camera stays at its centre); neither is fogged.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { idUnit } from "./idHash";

/** Degrees to radians. */
const DEG = Math.PI / 180;
/** How many stars the field holds. */
export const STAR_COUNT = 1500;
/** Stars start this far above the horizon, radians, where the glow would drown them anyway. */
export const STAR_MIN_ELEVATION_RAD = 4 * DEG;
/** Stars reach their full brightness this high, radians; below it they fade into the glow. */
const STAR_FULL_ELEVATION_RAD = 30 * DEG;
/** Salts of each star's seeded height, bearing, brightness and tint. */
const STAR_SALT = { height: 0x51, bearing: 0x52, brightness: 0x53, tint: 0x54 };
/** A star's brightness: a faint floor plus a share that only a few stars reach. */
const STAR_BRIGHTNESS = { floor: 0.16, range: 0.84, power: 3 };
/** Screen size of a star, px. */
const STAR_SIZE_PX = 2;
/** Blue-white, white and warm white stars. */
const STAR_TINTS = [0xcfdcff, 0xffffff, 0xfff0d2] as const;
/** Stars and moon hang at these shares of the dome's radius, inside it. */
const STAR_SHELL_SHARE = 0.96;
const MOON_SHELL_SHARE = 0.92;
/**
 * The moon's height above the horizon, radians: well below its light's (which shines steeply so
 * streets read), so the disc shows over the rooftops from street level.
 */
export const MOON_ELEVATION_RAD = 22 * DEG;
/** The moon's quad, metres at its shell; the disc fills {@link MOON_DISC_SHARE} of its width. */
const MOON_QUAD_M = 120;
const MOON_DISC_SHARE = 0.32;
/** The moon's pale face, its halo's peak opacity and the halo's falloff. */
const MOON_COLOUR = 0xf4f0e2;
const MOON_HALO = { alpha: 0.32, power: 2.2 };
/** The moon texture's side, px, and how soft the disc's rim is, as a share of its radius. */
const MOON_TEXTURE_PX = 128;
const MOON_RIM_SOFTNESS = 0.06;
/** The limb darkening: the rim is this much darker than the middle. */
const MOON_LIMB_DARKENING = 0.22;
/** Darker seas on the face: centre (share of the radius from the middle), radius share, depth. */
const MOON_SEAS: readonly (readonly [number, number, number, number])[] = [
  [-0.28, -0.22, 0.34, 0.16],
  [0.2, -0.3, 0.26, 0.12],
  [0.05, 0.3, 0.3, 0.1],
];
/**
 * The stars, then the moon over them, draw before every other see-through thing: sorted by
 * distance the stars (centred on the camera) would come last and shine through the moon.
 */
const STAR_RENDER_ORDER = -2;
const MOON_RENDER_ORDER = -1;
/** Channels per pixel, and a full 8-bit channel. */
const RGBA = 4;
const FULL_CHANNEL = 255;

/** Smooth 0 → 1 as `value` goes from `from` to `to`. */
function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * Where star `index` sits: a direction on the upper part of a unit sphere, spread evenly over the
 * sky above {@link STAR_MIN_ELEVATION_RAD}.
 *
 * @param index - The star.
 * @returns Its unit direction, y up.
 */
export function starDirection(index: number): Vector3 {
  const lowest = Math.sin(STAR_MIN_ELEVATION_RAD);
  const height = lowest + (1 - lowest) * idUnit(index, STAR_SALT.height);
  const bearing = idUnit(index, STAR_SALT.bearing) * Math.PI * 2;
  const across = Math.sqrt(1 - height * height);
  return new Vector3(
    Math.cos(bearing) * across,
    height,
    Math.sin(bearing) * across,
  );
}

/** Star `index`'s colour: its tint times its brightness, faded by how low it stands. */
function starColour(index: number, direction: Vector3): Color {
  const { floor, range, power } = STAR_BRIGHTNESS;
  const brightness =
    floor + range * idUnit(index, STAR_SALT.brightness) ** power;
  const fade = smoothstep(
    STAR_MIN_ELEVATION_RAD,
    STAR_FULL_ELEVATION_RAD,
    Math.asin(direction.y),
  );
  const tint =
    STAR_TINTS[Math.floor(idUnit(index, STAR_SALT.tint) * STAR_TINTS.length)];
  return new Color(tint).multiplyScalar(brightness * fade);
}

/**
 * The star field: one point per star on a shell inside the dome, added to what the sky already
 * shows, the same stars every time.
 *
 * @param domeRadius - The sky dome's radius, metres.
 * @returns The points, owning their geometry and material.
 */
export function createStarField(domeRadius: number): Points {
  const positions = new Float32Array(STAR_COUNT * 3);
  const colours = new Float32Array(STAR_COUNT * 3);
  const radius = domeRadius * STAR_SHELL_SHARE;
  for (let index = 0; index < STAR_COUNT; index++) {
    const direction = starDirection(index);
    positions.set(
      direction.clone().multiplyScalar(radius).toArray(),
      index * 3,
    );
    colours.set(starColour(index, direction).toArray(), index * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  const stars = new Points(
    geometry,
    new PointsMaterial({
      size: STAR_SIZE_PX,
      sizeAttenuation: false,
      vertexColors: true,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  stars.name = "stars";
  stars.renderOrder = STAR_RENDER_ORDER;
  stars.frustumCulled = false;
  return stars;
}

/**
 * Where the moon hangs: on its light's bearing, at {@link MOON_ELEVATION_RAD}.
 *
 * @param light - The moonlight's direction (where it shines from), y up.
 * @returns A unit direction.
 */
export function moonDirection(
  light: readonly [number, number, number],
): Vector3 {
  const bearing = Math.atan2(light[2], light[0]);
  const across = Math.cos(MOON_ELEVATION_RAD);
  return new Vector3(
    Math.cos(bearing) * across,
    Math.sin(MOON_ELEVATION_RAD),
    Math.sin(bearing) * across,
  );
}

/** How much darker the moon's face is at a point (x, y in disc radii from its middle). */
function moonShade(x: number, y: number): number {
  const limb = MOON_LIMB_DARKENING * (x * x + y * y);
  const seas = MOON_SEAS.reduce((sum, [cx, cy, radius, depth]) => {
    const reach = Math.hypot(x - cx, y - cy) / radius;
    return sum + depth * Math.max(0, 1 - reach * reach);
  }, 0);
  return 1 - limb - seas;
}

/** One pixel of the moon texture: the lit face inside the disc, the halo's glow outside it. */
function moonPixel(distance: number, x: number, y: number): [number, number] {
  const disc = MOON_DISC_SHARE;
  const rim = smoothstep(disc, disc * (1 - MOON_RIM_SOFTNESS), distance);
  const halo =
    MOON_HALO.alpha *
    Math.max(0, 1 - (distance - disc) / (1 - disc)) ** MOON_HALO.power;
  const shade = moonShade(x / disc, y / disc);
  return [rim * shade + (1 - rim), Math.max(rim, halo)];
}

/** The moon's face and halo on a white-based RGBA texture, tinted by the material's colour. */
function moonTexture(): DataTexture {
  const size = MOON_TEXTURE_PX;
  const data = new Uint8Array(size * size * RGBA);
  const half = (size - 1) / 2;
  for (let row = 0; row < size; row++)
    for (let column = 0; column < size; column++) {
      const x = (column - half) / half;
      const y = (row - half) / half;
      const [light, alpha] = moonPixel(Math.hypot(x, y), x, y);
      const offset = (row * size + column) * RGBA;
      data.fill(Math.round(FULL_CHANNEL * light), offset, offset + RGBA - 1);
      data[offset + RGBA - 1] = Math.round(FULL_CHANNEL * alpha);
    }
  const texture = new DataTexture(data, size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The moon: a quad facing the dome's centre (where the camera is), on the moonlight's bearing.
 *
 * @param domeRadius - The sky dome's radius, metres.
 * @param light - The moonlight's direction, y up.
 * @returns The moon mesh, owning its geometry, material and texture.
 */
export function createMoon(
  domeRadius: number,
  light: readonly [number, number, number],
): Mesh {
  const moon = new Mesh(
    new PlaneGeometry(MOON_QUAD_M, MOON_QUAD_M),
    new MeshBasicMaterial({
      map: moonTexture(),
      color: MOON_COLOUR,
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  moon.name = "moon";
  moon.renderOrder = MOON_RENDER_ORDER;
  moon.position.copy(
    moonDirection(light).multiplyScalar(domeRadius * MOON_SHELL_SHARE),
  );
  moon.lookAt(0, 0, 0);
  moon.frustumCulled = false;
  return moon;
}
