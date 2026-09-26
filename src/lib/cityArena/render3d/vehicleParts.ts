/**
 * Building blocks of the 3D vehicles: a material cache shared by every car, and the few primitive
 * shapes the models are cut from. A vehicle's static parts gather in a {@link PartSet} and merge
 * into one mesh with one draw group per material, so a car costs a handful of draw calls.
 *
 * Parts that are neither paint nor lamps (glass, trim, stripes, tyres) share one vertex-coloured
 * material instead of a material each: their colour travels in the geometry.
 */
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  type BufferGeometry,
  type Material,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** The charred black every part of a wreck turns to (spec §6.7). */
export const CHARRED_COLOUR = 0x1a1512;
/** Shininess of car paint and glass; enough for the moon to glint on a bonnet. */
const GLOSS_SHININESS = 60;
/** Specular tint of that glint, a soft grey so it never outshines the paint. */
const GLOSS_SPECULAR = 0x3a3a3a;
/** Sides of a cylinder unless a part asks for more or fewer: faceted, as low-poly art is. */
const DEFAULT_SEGMENTS = 12;
/** Vertex colour of parts whose material carries the colour itself. */
const NEUTRAL_TINT = 0xffffff;

/** A closed interval along one axis, metres: `[from, to]`. */
export type Span = readonly [number, number];

/** A point in the vehicle's frame: x forward, y up, z to the right, metres. */
export type Point3 = readonly [number, number, number];

/** How far a slab's top face is pulled in, metres: this slopes windscreens, noses and hulls. */
export type Taper = { front?: number; rear?: number; side?: number };

/** Slides a slab's x by `perMetre` for each metre along `axis`, leaning it into a stripe. */
export type Shear = { axis: "y" | "z"; perMetre: number };

/** A box from `x[0]` to `x[1]` along the body, `y[0]` to `y[1]` up, `width` across centred on `z`. */
export type SlabSpec = {
  x: Span;
  y: Span;
  width: number;
  z?: number;
  taper?: Taper;
  shear?: Shear;
};

/** A cylinder lying along `axis`, centred `at`; its top end points along +axis. */
export type CylinderSpec = {
  radius: number;
  radiusTop?: number;
  length: number;
  axis: "x" | "y" | "z";
  at: Point3;
  segments?: number;
  stretchX?: number;
};

/** A wheel's size and colours; the hub is the cross that shows it turning. */
export type WheelLook = {
  radius: number;
  width: number;
  tyre: number;
  rim: number;
  hub: number;
};

/** Caches one value per key, so every caller asking for the same colour gets the same material. */
function memoise<K, V>(create: (key: K) => V): (key: K) => V {
  const cache = new Map<K, V>();
  return (key) => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = create(key);
    cache.set(key, value);
    return value;
  };
}

/**
 * The glossy paint of one body colour, shared by every vehicle painted in it.
 *
 * @param hex - The colour, `0xrrggbb`.
 * @returns The shared material.
 */
export const paintMaterial: (hex: number) => MeshPhongMaterial = memoise(
  (hex: number) =>
    new MeshPhongMaterial({
      color: hex,
      shininess: GLOSS_SHININESS,
      specular: GLOSS_SPECULAR,
      flatShading: true,
    }),
);

/** The one vertex-coloured material, created on first use. */
let sharedDetail: MeshPhongMaterial | null = null;

/**
 * The material of glass, trim, stripes and tyres: its colour comes from the vertices.
 *
 * @returns The shared material.
 */
export function detailMaterial(): MeshPhongMaterial {
  sharedDetail ??= new MeshPhongMaterial({
    vertexColors: true,
    shininess: GLOSS_SHININESS,
    specular: GLOSS_SPECULAR,
    flatShading: true,
  });
  return sharedDetail;
}

/**
 * A lamp that glows by itself, shared per colour.
 *
 * @param hex - The lamp colour, `0xrrggbb`.
 * @returns The shared emissive material.
 */
export const glowMaterial: (hex: number) => MeshLambertMaterial = memoise(
  (hex: number) => new MeshLambertMaterial({ color: hex, emissive: hex }),
);

/**
 * A dull, unlit surface, shared per colour: dark lenses and the wreck's char.
 *
 * @param hex - The colour, `0xrrggbb`.
 * @returns The shared material.
 */
export const matteMaterial: (hex: number) => MeshLambertMaterial = memoise(
  (hex: number) => new MeshLambertMaterial({ color: hex, flatShading: true }),
);

/**
 * The one charred material every part of every wreck wears.
 *
 * @returns The shared material.
 */
export function charredMaterial(): MeshLambertMaterial {
  return matteMaterial(CHARRED_COLOUR);
}

/** Pulls the top face of a box centred on the origin in by `taper`. */
function pullInTop(geometry: BufferGeometry, taper: Taper): void {
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    if (position.getY(index) <= 0) continue;
    const x = position.getX(index);
    const z = position.getZ(index);
    position.setX(
      index,
      x > 0 ? x - (taper.front ?? 0) : x + (taper.rear ?? 0),
    );
    position.setZ(index, z - Math.sign(z) * (taper.side ?? 0));
  }
}

/** Leans a box centred on the origin forward by `shear`. */
function shearAlong(geometry: BufferGeometry, shear: Shear): void {
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const along =
      shear.axis === "y" ? position.getY(index) : position.getZ(index);
    position.setX(index, position.getX(index) + along * shear.perMetre);
  }
}

/**
 * A box between two heights and two points along the body, optionally tapered or leaned. Every
 * face stays flat, so the flat-shaded look survives the reshaping.
 *
 * @param spec - Extent, width and shape.
 * @returns A new geometry in the vehicle's frame.
 */
export function slab(spec: SlabSpec): BufferGeometry {
  const [x0, x1] = spec.x;
  const [y0, y1] = spec.y;
  const geometry = new BoxGeometry(x1 - x0, y1 - y0, spec.width);
  if (spec.taper) pullInTop(geometry, spec.taper);
  if (spec.shear) shearAlong(geometry, spec.shear);
  if (spec.taper || spec.shear) geometry.computeVertexNormals();
  geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, spec.z ?? 0);
  return geometry;
}

/**
 * A cylinder or cone along one axis: wheels, fenders, barrels, lamps.
 *
 * @param spec - Radii, length, axis and centre.
 * @returns A new geometry in the vehicle's frame.
 */
export function cylinder(spec: CylinderSpec): BufferGeometry {
  const geometry = new CylinderGeometry(
    spec.radiusTop ?? spec.radius,
    spec.radius,
    spec.length,
    spec.segments ?? DEFAULT_SEGMENTS,
  );
  if (spec.axis === "x") geometry.rotateZ(-Math.PI / 2);
  if (spec.axis === "z") geometry.rotateX(Math.PI / 2);
  if (spec.stretchX !== undefined) geometry.scale(spec.stretchX, 1, 1);
  geometry.translate(...spec.at);
  return geometry;
}

/** Writes one colour into every vertex, in three's working colour space. */
function tintVertices(geometry: BufferGeometry, hex: number): void {
  const colour = new Color(hex);
  const count = geometry.getAttribute("position").count;
  const data = new Float32Array(count * 3);
  for (let index = 0; index < count; index++)
    data.set([colour.r, colour.g, colour.b], index * 3);
  geometry.setAttribute("color", new BufferAttribute(data, 3));
}

/** Merges geometries into one and frees the pieces. */
function mergeAndRelease(
  geometries: BufferGeometry[],
  useGroups: boolean,
): BufferGeometry {
  const merged = mergeGeometries(geometries, useGroups);
  for (const geometry of geometries) geometry.dispose();
  return merged;
}

/** Static parts collected per material, merged into one mesh at the end. */
export type PartSet = {
  /** Adds a part; `tint` colours it when its material takes vertex colours. */
  add(material: Material, geometry: BufferGeometry, tint?: number): void;
  /** Merges everything added so far into one mesh, one draw group per material. */
  toMesh(name: string): Mesh;
};

/**
 * An empty set of parts.
 *
 * @returns A collector whose `toMesh` merges the parts per material.
 */
export function createPartSet(): PartSet {
  const buckets = new Map<Material, BufferGeometry[]>();
  return {
    add(material, geometry, tint = NEUTRAL_TINT) {
      tintVertices(geometry, tint);
      const bucket = buckets.get(material);
      if (bucket) bucket.push(geometry);
      else buckets.set(material, [geometry]);
    },
    toMesh(name) {
      const perMaterial = [...buckets.values()].map((bucket) =>
        mergeAndRelease(bucket, false),
      );
      const mesh = new Mesh(mergeAndRelease(perMaterial, true), [
        ...buckets.keys(),
      ]);
      mesh.name = name;
      buckets.clear();
      return mesh;
    },
  };
}

/** Share of the radius the rim covers. */
const RIM_SHARE = 0.62;
/** Share of the radius each arm of the hub cross reaches. */
const HUB_REACH = 0.58;
/** Thickness of a hub arm as a share of the radius. */
const HUB_ARM_SHARE = 0.18;
/** How far rim and hub stand out of the tyre on each face, metres. */
const HUB_PROUD_M = 0.015;
/** Sides of the rim: fewer than the tyre, so the two outlines differ. */
const RIM_SEGMENTS = 10;

/**
 * One wheel with its axle along z, centred on the origin: tyre, rim and a hub cross that shows the
 * wheel turning. The hub's faces are the outermost, exactly `look.width` apart. Vertex-coloured
 * for {@link detailMaterial}.
 *
 * @param look - Size and colours.
 * @returns A new geometry.
 */
export function wheelGeometry(look: WheelLook): BufferGeometry {
  const { radius, width } = look;
  const reach = radius * HUB_REACH;
  const arm = radius * HUB_ARM_SHARE;
  const parts: [BufferGeometry, number][] = [
    [
      cylinder({
        radius,
        length: width - 2 * HUB_PROUD_M,
        axis: "z",
        at: [0, 0, 0],
      }),
      look.tyre,
    ],
    [
      cylinder({
        radius: radius * RIM_SHARE,
        length: width - HUB_PROUD_M,
        axis: "z",
        at: [0, 0, 0],
        segments: RIM_SEGMENTS,
      }),
      look.rim,
    ],
    [slab({ x: [-reach, reach], y: [-arm / 2, arm / 2], width }), look.hub],
    [slab({ x: [-arm / 2, arm / 2], y: [-reach, reach], width }), look.hub],
  ];
  for (const [geometry, hex] of parts) tintVertices(geometry, hex);
  return mergeAndRelease(
    parts.map(([geometry]) => geometry),
    false,
  );
}
