import { describe, expect, it } from "vitest";
import { Vector3, type BufferAttribute } from "three";
import { boundsOf } from "../mapBuild/geometry";
import type { DecodedBuilding } from "../world/decode";
import { createDetailBuffers } from "./detailBuffers";
import { bellOutline, pushGableHouse, stepOutline } from "./gableHouse";
import { createMeshBuffers, toGeometry } from "./meshBuffers";
import { createWallBuffers, wallGeometry } from "./wallQuads";

/** How far above the roof line every outline must stand, metres. */
const MARGIN_M = 0.3;

describe("gable outlines", () => {
  it.each([
    ["step", stepOutline],
    ["bell", bellOutline],
  ] as const)(
    "keeps a %s gable rising, inside its width and over the roof line",
    (_, outline) => {
      for (const [half, rise] of [
        [2.5, 3],
        [3.5, 4.2],
        [4, 4.8],
      ]) {
        const chain = outline(half, rise);

        expect(chain[0]).toEqual([half, 0]);
        expect(chain[chain.length - 1][0]).toBe(0);
        chain
          .slice(1)
          .forEach(([, height], index) =>
            expect(height).toBeGreaterThanOrEqual(chain[index][1]),
          );
        for (const [across, height] of chain.slice(1)) {
          expect(across).toBeLessThanOrEqual(half);
          const roof = rise * Math.max(0, 1 - across / half);
          expect(height).toBeGreaterThanOrEqual(roof + MARGIN_M - 1e-9);
        }
        const top = Math.max(...chain.map(([, height]) => height));
        expect(top).toBeGreaterThan(rise + MARGIN_M);
      }
    },
  );
});

describe("pushGableHouse", () => {
  const ring: [number, number][] = [
    [0, 7],
    [6, 7],
    [6, 21],
    [0, 21],
  ];
  const house: DecodedBuilding = {
    structureId: 1,
    ring,
    bounds: boundsOf(ring),
    levels: 2,
  };

  it("stands the street gable on the street end, clear of the roof behind it", () => {
    const targets = {
      tiled: createMeshBuffers(),
      walls: createWallBuffers(),
      detail: createDetailBuffers(),
    };

    const ridge = pushGableHouse(
      targets,
      house,
      { end: -1, kind: "step" },
      { eaves: 6.2, sheet: 0, fascia: 0xffffff, origin: [0, 0] },
    );

    const walls = wallGeometry(targets.walls).getAttribute(
      "position",
    ) as BufferAttribute;
    const roof = toGeometry(targets.tiled).getAttribute(
      "position",
    ) as BufferAttribute;
    const wallTop = Math.max(
      ...Array.from({ length: walls.count }, (_, at) => walls.getY(at)),
    );
    const roofTop = Math.max(
      ...Array.from({ length: roof.count }, (_, at) => roof.getY(at)),
    );
    expect(ridge).toBeCloseTo(roofTop, 5);
    expect(wallTop).toBeGreaterThan(roofTop);
    const streetSide = Array.from({ length: walls.count }, (_, at) =>
      new Vector3().fromBufferAttribute(walls, at),
    ).filter((vertex) => vertex.y > roofTop);
    for (const vertex of streetSide) expect(vertex.z).toBeLessThan(8);
    expect(targets.detail.positions.length).toBeGreaterThan(0);
  });
});
