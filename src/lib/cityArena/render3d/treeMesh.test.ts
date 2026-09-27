import { describe, expect, it } from "vitest";
import { Color, Matrix4, Vector3, type InstancedMesh } from "three";
import { TREE_CANOPY_M } from "../world/mapTypes";
import { createTestMaterials } from "./testing/cityFixture";
import {
  buildDetailedTreeLayer,
  buildTreeLayer,
  type TreeInput,
} from "./treeMesh";
import { TREE_SPECIES, speciesOf } from "./treeSpecies";

/** A grove of trees in a grid, ids counting up from `first`. */
function grove(count: number, first = 1000): TreeInput[] {
  return Array.from({ length: count }, (_, index) => ({
    point: [(index % 20) * 7, Math.floor(index / 20) * 7],
    size: (index % 3 === 0 ? 1 : 0) as 0 | 1,
    id: first + index,
  }));
}

/** Every instance matrix of a mesh. */
function matrices(mesh: InstancedMesh): Matrix4[] {
  return Array.from({ length: mesh.count }, (_, index) => {
    const matrix = new Matrix4();
    mesh.getMatrixAt(index, matrix);
    return matrix;
  });
}

describe("speciesOf", () => {
  it("grows every species, mostly broadleaf, the same for the same id", () => {
    const counts = new Map<string, number>();
    for (let id = 0; id < 2000; id++) {
      const species = speciesOf(id);
      counts.set(species, (counts.get(species) ?? 0) + 1);
      expect(speciesOf(id)).toBe(species);
    }

    expect([...counts.keys()].sort()).toEqual([...TREE_SPECIES].sort());
    expect(counts.get("broadleaf")!).toBeGreaterThan(1000);
    expect(counts.get("poplar")!).toBeGreaterThan(250);
    expect(counts.get("conifer")!).toBeGreaterThan(250);
  });
});

describe("buildDetailedTreeLayer", () => {
  it("draws one trunk per tree and one crown per tree across the species' meshes", () => {
    const materials = createTestMaterials();
    const trees = grove(120);

    const { meshes } = buildDetailedTreeLayer(trees, materials, [0, 0]);

    const [trunks, ...crowns] = meshes as InstancedMesh[];
    expect(trunks.material).toBe(materials.treeTrunk);
    expect(trunks.count).toBe(trees.length);
    expect(crowns.length).toBe(TREE_SPECIES.length);
    expect(crowns.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(
      trees.length,
    );
    for (const crown of crowns) expect(crown.material).toBe(materials.canopy);
  });

  it("sizes each crown within a fifth of its class and tints it an evening green", () => {
    const materials = createTestMaterials();
    const trees = grove(80);

    const { meshes } = buildDetailedTreeLayer(trees, materials, [0, 0]);

    const crowns = (meshes as InstancedMesh[]).slice(1);
    const largest = (TREE_CANOPY_M[1] / 2) * 1.3 * 1.2;
    const colour = new Color();
    for (const crown of crowns)
      matrices(crown).forEach((matrix, index) => {
        const scale = new Vector3().setFromMatrixScale(matrix);
        expect(scale.x).toBeGreaterThan(0);
        expect(scale.x).toBeLessThanOrEqual(largest + 1e-6);
        crown.getColorAt(index, colour);
        expect(colour.g).toBeGreaterThan(colour.r);
        expect(colour.g).toBeGreaterThan(colour.b);
      });
  });

  it("plants the same grove every time", () => {
    const materials = createTestMaterials();
    const build = (): number[][] =>
      (
        buildDetailedTreeLayer(grove(60), materials, [5, 5])
          .meshes as InstancedMesh[]
      ).map((mesh) => matrices(mesh).flatMap((matrix) => matrix.elements));

    expect(build()).toEqual(build());
  });

  it("builds nothing for no trees", () => {
    expect(
      buildDetailedTreeLayer([], createTestMaterials(), [0, 0]).meshes,
    ).toEqual([]);
  });
});

describe("buildTreeLayer (basic)", () => {
  it("keeps the first city's trunks and two alternating greens", () => {
    const materials = createTestMaterials();

    const { meshes } = buildTreeLayer(grove(20), materials, [0, 0]);

    expect(meshes.map((mesh) => mesh.material)).toEqual([
      materials.treeTrunk,
      materials.canopies[0],
      materials.canopies[1],
    ]);
  });
});
