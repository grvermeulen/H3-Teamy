/**
 * The two projectiles you can see coming: the rocket launcher's rocket (a 0.9 m body with fins and
 * a burning motor) and the tank's shell (a short glowing slug). Geometry and materials are built
 * once and shared by every projectile in flight; models face +X like every 3D model here.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type BufferGeometry,
  type Material,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Nose to tail of the rocket, metres (spec §6.8). */
export const ROCKET_LENGTH_M = 0.9;
/** Radius of the rocket's tube, metres. */
const ROCKET_RADIUS_M = 0.06;
/** Length of the rocket's pointed nose, metres; the tube is the rest. */
const ROCKET_NOSE_M = 0.18;
/** Fins at the tail: length along the tube, how far they stand out, and thickness, metres. */
const FIN_LENGTH_M = 0.16;
const FIN_SPAN_M = 0.1;
const FIN_THICKNESS_M = 0.012;
/** Olive drab of the rocket's tube. */
const ROCKET_COLOUR = 0x5b6348;
/** The motor's flame: radius at the nozzle, length behind the rocket, colour. */
const FLAME_RADIUS_M = 0.09;
const FLAME_LENGTH_M = 0.35;
const FLAME_COLOUR = 0xffb347;
/** The tank shell: radius, length of its straight part, and its glow. */
const SHELL_RADIUS_M = 0.09;
const SHELL_BODY_M = 0.35;
const SHELL_COLOUR = 0xffe2a0;
/** Sides of the round parts; small things need few. */
const ROUND_SEGMENTS = 10;
/** Quarter turn, radians. */
const QUARTER_TURN = Math.PI / 2;

/** Which projectile a model is. */
export type ProjectileLook = "rocket" | "shell";

/** Shared geometry and materials of the projectile models. */
export type ProjectileKit = {
  /** A new model of a look; its geometry and materials belong to the kit. */
  build(look: ProjectileLook): Group;
  /** Frees the shared geometry and materials. */
  dispose(): void;
};

/** The rocket's tube, nose and four fins as one geometry spanning x ∈ [−0.45, 0.45]. */
function rocketBodyGeometry(): BufferGeometry {
  const tail = -ROCKET_LENGTH_M / 2;
  const tubeLength = ROCKET_LENGTH_M - ROCKET_NOSE_M;
  const tube = new CylinderGeometry(
    ROCKET_RADIUS_M,
    ROCKET_RADIUS_M,
    tubeLength,
    ROUND_SEGMENTS,
  )
    .rotateZ(-QUARTER_TURN)
    .translate(tail + tubeLength / 2, 0, 0);
  const nose = new ConeGeometry(ROCKET_RADIUS_M, ROCKET_NOSE_M, ROUND_SEGMENTS)
    .rotateZ(-QUARTER_TURN)
    .translate(tail + tubeLength + ROCKET_NOSE_M / 2, 0, 0);
  const fins = [0, 1, 2, 3].map((quarter) =>
    new BoxGeometry(FIN_LENGTH_M, FIN_THICKNESS_M, FIN_SPAN_M)
      .translate(tail + FIN_LENGTH_M / 2, 0, ROCKET_RADIUS_M + FIN_SPAN_M / 2)
      .rotateX(quarter * QUARTER_TURN),
  );
  const parts = [tube, nose, ...fins];
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/** The motor's flame: a cone pointing back from the rocket's tail. */
function flameGeometry(): BufferGeometry {
  return new ConeGeometry(FLAME_RADIUS_M, FLAME_LENGTH_M, ROUND_SEGMENTS)
    .rotateZ(QUARTER_TURN)
    .translate(-ROCKET_LENGTH_M / 2 - FLAME_LENGTH_M / 2, 0, 0);
}

function shellGeometry(): BufferGeometry {
  return new CapsuleGeometry(
    SHELL_RADIUS_M,
    SHELL_BODY_M,
    2,
    ROUND_SEGMENTS,
  ).rotateZ(-QUARTER_TURN);
}

function glow(colour: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: colour,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

function named(mesh: Mesh, name: string): Mesh {
  mesh.name = name;
  return mesh;
}

/**
 * Builds the shared projectile geometry and materials.
 *
 * @returns A kit that builds rocket and shell models from them.
 */
export function createProjectileKit(): ProjectileKit {
  const geometries = {
    body: rocketBodyGeometry(),
    flame: flameGeometry(),
    shell: shellGeometry(),
  };
  const materials = {
    body: new MeshLambertMaterial({ color: ROCKET_COLOUR }),
    flame: glow(FLAME_COLOUR),
    shell: glow(SHELL_COLOUR),
  };
  return {
    build(look) {
      const root = new Group();
      root.name = look;
      if (look === "shell")
        root.add(named(new Mesh(geometries.shell, materials.shell), "slug"));
      else
        root.add(
          named(new Mesh(geometries.body, materials.body), "rocket-body"),
          named(new Mesh(geometries.flame, materials.flame), "rocket-flame"),
        );
      return root;
    },
    dispose() {
      for (const geometry of Object.values(geometries)) geometry.dispose();
      for (const material of Object.values<Material>(materials))
        material.dispose();
    },
  };
}
