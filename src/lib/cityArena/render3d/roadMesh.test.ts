import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import {
  createMeshBuffers,
  vertexCount,
  type MeshBuffers,
} from "./meshBuffers";
import {
  DASH_LENGTH_M,
  LAMP_KERB_OFFSET_M,
  LAMP_SPACING_M,
  lampsAlong,
  pushDashes,
  pushRibbon,
} from "./roadMesh";

const ORIGIN: Point = [0, 0];
const uv = (x: number, y: number): [number, number] => [x / 8, y / 8];
const WORLD = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

/** The (x, z) of every vertex in the buffers. */
function flatVertices(buffers: MeshBuffers): Point[] {
  return Array.from({ length: vertexCount(buffers) }, (_, index): Point => [
    buffers.positions[index * 3],
    buffers.positions[index * 3 + 2],
  ]);
}

/** The y of each triangle's geometric normal. */
function normalYs(buffers: MeshBuffers): number[] {
  const at = (vertex: number): number[] =>
    buffers.positions.slice(vertex * 3, vertex * 3 + 3);
  const ys: number[] = [];
  for (let index = 0; index < buffers.indices.length; index += 3) {
    const [a, b, c] = buffers.indices.slice(index, index + 3).map(at);
    ys.push((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]));
  }
  return ys;
}

describe("pushRibbon", () => {
  it("lays a straight ribbon of the given width, facing up", () => {
    const buffers = createMeshBuffers();

    pushRibbon(
      buffers,
      {
        points: [
          [0, 0],
          [20, 0],
        ],
        capStart: false,
        capEnd: false,
      },
      6,
      0.02,
      ORIGIN,
      uv,
    );

    const zs = flatVertices(buffers).map(([, z]) => z);
    expect(Math.min(...zs)).toBeCloseTo(-3);
    expect(Math.max(...zs)).toBeCloseTo(3);
    expect(buffers.indices).toHaveLength(6);
    for (const y of normalYs(buffers)) expect(y).toBeGreaterThan(0);
  });

  it("mitres a right-angle bend so both arms keep their width", () => {
    const buffers = createMeshBuffers();

    pushRibbon(
      buffers,
      {
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        capStart: false,
        capEnd: false,
      },
      4,
      0,
      ORIGIN,
      uv,
    );

    const corners = flatVertices(buffers).slice(2, 4);
    const reach = corners.map(([x, z]) => Math.hypot(x - 10, z));
    for (const distance of reach) expect(distance).toBeCloseTo(2 * Math.SQRT2);
    for (const y of normalYs(buffers)) expect(y).toBeGreaterThan(0);
  });

  it("rounds only the ends that are the road's own ends", () => {
    const open = createMeshBuffers();
    const capped = createMeshBuffers();
    const piece = {
      points: [
        [0, 0],
        [20, 0],
      ] as Point[],
    };

    pushRibbon(
      open,
      { ...piece, capStart: false, capEnd: false },
      6,
      0,
      ORIGIN,
      uv,
    );
    pushRibbon(
      capped,
      { ...piece, capStart: true, capEnd: false },
      6,
      0,
      ORIGIN,
      uv,
    );

    const reachWest = (buffers: MeshBuffers): number =>
      Math.min(...flatVertices(buffers).map(([x]) => x));
    expect(reachWest(open)).toBeCloseTo(0);
    expect(reachWest(capped)).toBeCloseTo(-3);
    for (const y of normalYs(capped)) expect(y).toBeGreaterThan(0);
  });
});

describe("pushDashes", () => {
  it("dashes a centre line once across two neighbouring regions, in phase", () => {
    const line: Point[] = [
      [0, 5],
      [100, 5],
    ];
    const west = createMeshBuffers();
    const east = createMeshBuffers();
    const whole = createMeshBuffers();

    pushDashes(
      west,
      line,
      { minX: 0, minY: 0, maxX: 50, maxY: 10 },
      0.03,
      ORIGIN,
      uv,
    );
    pushDashes(
      east,
      line,
      { minX: 50, minY: 0, maxX: 100, maxY: 10 },
      0.03,
      ORIGIN,
      uv,
    );
    pushDashes(
      whole,
      line,
      { minX: 0, minY: 0, maxX: 100, maxY: 10 },
      0.03,
      ORIGIN,
      uv,
    );

    expect(vertexCount(west) + vertexCount(east)).toBe(vertexCount(whole));
    const starts = flatVertices(whole)
      .filter((_, index) => index % 4 === 0)
      .map(([x]) => x);
    expect(starts.slice(0, 3)).toEqual([0, 6, 12]);
    const firstDash = flatVertices(whole)
      .slice(0, 4)
      .map(([x]) => x);
    expect(Math.max(...firstDash) - Math.min(...firstDash)).toBeCloseTo(
      DASH_LENGTH_M,
    );
  });
});

describe("lampsAlong", () => {
  it("sets lamps out on alternating sides past the kerb, arms toward the road", () => {
    const lamps = lampsAlong(
      [
        [0, 0],
        [200, 0],
      ],
      6,
      WORLD,
    );

    expect(lamps.length).toBe(
      Math.floor((200 - LAMP_SPACING_M / 2) / LAMP_SPACING_M) + 1,
    );
    lamps.forEach((lamp, index) => {
      expect(lamp.x).toBeCloseTo(LAMP_SPACING_M / 2 + index * LAMP_SPACING_M);
      expect(Math.abs(lamp.y)).toBeCloseTo(3 + LAMP_KERB_OFFSET_M);
      expect(Math.sign(lamp.y)).toBe(index % 2 === 0 ? 1 : -1);
      expect(Math.sin(lamp.heading) * Math.sign(lamp.y)).toBeCloseTo(-1);
    });
  });

  it("keeps lamps out of the junctions at a short road's ends", () => {
    expect(
      lampsAlong(
        [
          [0, 0],
          [12, 0],
        ],
        6,
        WORLD,
      ),
    ).toEqual([]);
  });

  it("places each lamp from one region only", () => {
    const west = lampsAlong(
      [
        [0, 0],
        [200, 0],
      ],
      6,
      { ...WORLD, maxX: 100 },
    );
    const east = lampsAlong(
      [
        [0, 0],
        [200, 0],
      ],
      6,
      { ...WORLD, minX: 100 },
    );

    expect(west.length + east.length).toBe(
      lampsAlong(
        [
          [0, 0],
          [200, 0],
        ],
        6,
        WORLD,
      ).length,
    );
  });
});
