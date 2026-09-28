/**
 * Pools of lamplight on the street under the lamps: a soft additive disc on the ground below each
 * lamp head, instanced per cell. Pools never write depth, and they fade to nothing in the fog
 * (fog would otherwise tint an additive disc toward the fog's colour and leave pale rings in the
 * distance). A lamp that is hidden or knocked out of upright puts its pool out.
 */
import {
  AdditiveBlending,
  DataTexture,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type Material,
} from "three";

/** A pool's radius, metres: about the height of the lamp over it. */
export const LAMP_POOL_RADIUS_M = 5;
/** A pool's height over the ground, metres: just above the road markings. */
export const LAMP_POOL_Y_M = 0.05;
/** How much of the lamp's colour a pool adds at its middle. */
const POOL_STRENGTH = 0.5;
/** A lamp leaning further from upright than this (cosine of the lean) no longer lights the street. */
const UPRIGHT_COSINE = 0.96;
/** Side of the pool's texture, px, and the exponent of its falloff to the rim. */
const POOL_TEXTURE_PX = 64;
const POOL_FALLOFF_POWER = 1.6;
/** Channels per pixel, and a full 8-bit channel. */
const RGBA = 4;
const FULL_CHANNEL = 255;

/** Fades an additive surface to black with the fog, where three would mix it toward the fog's colour. */
const FOG_TO_BLACK_GLSL = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float poolFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float poolFog = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb *= 1.0 - poolFog;
#endif
`;

/** A white disc whose alpha falls from full at the middle to nothing at the rim. */
function poolTexture(): DataTexture {
  const size = POOL_TEXTURE_PX;
  const data = new Uint8Array(size * size * RGBA);
  const half = (size - 1) / 2;
  for (let row = 0; row < size; row++)
    for (let column = 0; column < size; column++) {
      const rim = Math.hypot(column - half, row - half) / half;
      const offset = (row * size + column) * RGBA;
      data.fill(FULL_CHANNEL, offset, offset + RGBA - 1);
      data[offset + RGBA - 1] = Math.round(
        FULL_CHANNEL * Math.max(0, 1 - rim) ** POOL_FALLOFF_POWER,
      );
    }
  const texture = new DataTexture(data, size, size);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The pools' shared material: the lamp's colour at {@link POOL_STRENGTH}, added to the ground,
 * fading to nothing in the fog.
 *
 * @param colour - The lamps' light colour.
 * @returns A new material owning its texture.
 */
export function createLampPoolMaterial(colour: number): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    map: poolTexture(),
    color: colour,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  material.color.multiplyScalar(POOL_STRENGTH);
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <fog_fragment>",
      FOG_TO_BLACK_GLSL,
    );
  };
  material.customProgramCacheKey = () => "lamp-pool";
  return material;
}

/**
 * A cell's pools, one instance per lamp, all out until posed.
 *
 * @param count - How many lamps the cell has.
 * @param material - The pools' material.
 * @returns The instanced pools; pose each with {@link lampPoolMatrix}.
 */
export function createLampPools(
  count: number,
  material: Material,
): InstancedMesh {
  const quad = new PlaneGeometry(
    LAMP_POOL_RADIUS_M * 2,
    LAMP_POOL_RADIUS_M * 2,
  ).rotateX(-Math.PI / 2);
  const pools = new InstancedMesh(quad, material, count);
  pools.name = "lamp-pools";
  pools.matrixAutoUpdate = false;
  return pools;
}

/** Scratch for the head's position and the pole's up axis. */
const HEAD = new Vector3();
const UP = new Vector3();

/**
 * Where a lamp's pool lies: on the ground under its head while the lamp stands upright, out (a
 * zero-scale matrix) when it is hidden or has been knocked over.
 *
 * @param pose - The lamp's pose in the cell's frame.
 * @param head - The lamp head's middle in the lamp's own frame.
 * @param shown - Whether the lamp is shown at all.
 * @param out - Receives the pool's matrix.
 * @returns `out`.
 */
export function lampPoolMatrix(
  pose: Matrix4,
  head: Vector3,
  shown: boolean,
  out: Matrix4,
): Matrix4 {
  UP.setFromMatrixColumn(pose, 1).normalize();
  if (!shown || UP.y < UPRIGHT_COSINE) return out.makeScale(0, 0, 0);
  HEAD.copy(head).applyMatrix4(pose);
  return out.makeTranslation(HEAD.x, LAMP_POOL_Y_M, HEAD.z);
}
