import { describe, expect, it } from "vitest";
import { InstancedMesh, Matrix4, Vector3, type Object3D } from "three";
import { buildFurnitureLayer, type PlacedFurniture } from "./furnitureMesh";
import {
  createLampPoolMaterial,
  LAMP_POOL_Y_M,
  lampPoolMatrix,
} from "./lampPools";
import { createTestMaterials } from "./testing/cityFixture";

/** Three lamps and a bench along a street. */
const PIECES: PlacedFurniture[] = [
  { kind: "lamp", x: 10, y: 5, heading: 0 },
  { kind: "bench", x: 14, y: 5, heading: 0 },
  { kind: "lamp", x: 30, y: 5, heading: Math.PI / 2 },
  { kind: "lamp", x: 50, y: 5, heading: Math.PI },
];

/** The layer's pools, when it has them. */
function poolsOf(objects: readonly Object3D[]): InstancedMesh | undefined {
  return objects.find(
    (object): object is InstancedMesh =>
      object instanceof InstancedMesh && object.name === "lamp-pools",
  );
}

/** Where each pool lies, or null for one that is out. */
function poolSpots(pools: InstancedMesh): (Vector3 | null)[] {
  return Array.from({ length: pools.count }, (_, index) => {
    const matrix = new Matrix4();
    pools.getMatrixAt(index, matrix);
    const scale = new Vector3().setFromMatrixScale(matrix);
    return scale.x === 0 ? null : new Vector3().setFromMatrixPosition(matrix);
  });
}

describe("lampPoolMatrix", () => {
  const head = new Vector3(1.2, 4.4, 0);

  it("lays the pool on the ground under the head of an upright lamp", () => {
    const pose = new Matrix4()
      .makeRotationY(Math.PI / 2)
      .setPosition(20, 0, -3);

    const spot = new Vector3().setFromMatrixPosition(
      lampPoolMatrix(pose, head, true, new Matrix4()),
    );

    expect(spot.x).toBeCloseTo(20, 5);
    expect(spot.y).toBe(LAMP_POOL_Y_M);
    expect(spot.z).toBeCloseTo(-3 - 1.2, 5);
  });

  it("puts the pool out for a hidden lamp and for one knocked over", () => {
    const upright = new Matrix4();
    const fallen = new Matrix4().makeRotationZ(Math.PI / 2);
    const leaning = new Matrix4().makeRotationX(0.5);

    for (const [pose, shown] of [
      [upright, false],
      [fallen, true],
      [leaning, true],
    ] as const) {
      const scale = new Vector3().setFromMatrixScale(
        lampPoolMatrix(pose, head, shown, new Matrix4()),
      );
      expect(scale.length()).toBe(0);
    }
  });
});

describe("createLampPoolMaterial", () => {
  it("adds light without writing depth and fades it to black in the fog", () => {
    const material = createLampPoolMaterial(0xffc46b);
    const shader = {
      fragmentShader: "void main() {\n#include <fog_fragment>\n}",
    };

    material.onBeforeCompile(shader as never, undefined as never);

    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(true);
    expect(shader.fragmentShader).not.toContain("#include <fog_fragment>");
    expect(shader.fragmentShader).toContain(
      "gl_FragColor.rgb *= 1.0 - poolFog",
    );
  });
});

describe("buildFurnitureLayer pools", () => {
  it("lays one pool per lamp when asked, and none otherwise", () => {
    const materials = createTestMaterials();

    const withPools = buildFurnitureLayer(PIECES, materials, [0, 0], {
      pools: true,
    });
    const without = buildFurnitureLayer(PIECES, materials, [0, 0]);

    const pools = poolsOf(withPools.objects);
    expect(pools?.count).toBe(3);
    expect(pools?.material).toBe(materials.lampPool);
    expect(poolSpots(pools!).every((spot) => spot !== null)).toBe(true);
    expect(poolsOf(without.objects)).toBeUndefined();
  });

  it("puts a knocked-over lamp's pool out on the next sync", () => {
    const layer = buildFurnitureLayer(PIECES, createTestMaterials(), [0, 0], {
      pools: true,
    });
    const lamp = layer.furniture[2];

    lamp.object.rotation.z = Math.PI / 2;
    layer.sync([lamp]);

    const spots = poolSpots(poolsOf(layer.objects)!);
    expect(spots[1]).toBeNull();
    expect(spots[0]).not.toBeNull();
    expect(spots[2]).not.toBeNull();
  });
});
