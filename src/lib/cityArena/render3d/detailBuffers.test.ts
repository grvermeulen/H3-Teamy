import { describe, expect, it } from "vitest";
import { Color, Vector3, type BufferAttribute } from "three";
import {
  UPRIGHT_AXES,
  axesAlong,
  createDetailBuffers,
  detailGeometry,
  pushDetailBox,
  pushDetailQuad,
} from "./detailBuffers";

/** The geometric normal of each indexed triangle of a geometry. */
function faceNormals(geometry: ReturnType<typeof detailGeometry>): Vector3[] {
  const position = geometry.getAttribute("position") as BufferAttribute;
  const index = geometry.getIndex()!;
  const at = (i: number): Vector3 =>
    new Vector3().fromBufferAttribute(position, index.getX(i));
  const normals: Vector3[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [at(i), at(i + 1), at(i + 2)];
    normals.push(b.sub(a).cross(c.sub(a)).normalize());
  }
  return normals;
}

describe("pushDetailBox", () => {
  it("builds six outward faces of four vertices, or five without its bottom", () => {
    const whole = createDetailBuffers();
    const open = createDetailBuffers();
    const box = {
      centre: [1, 2, 3] as [number, number, number],
      axes: UPRIGHT_AXES,
      size: [2, 1, 4] as [number, number, number],
      colour: 0xff0000,
    };

    pushDetailBox(whole, box);
    pushDetailBox(open, { ...box, openBottom: true });

    expect(whole.positions.length / 3).toBe(24);
    expect(whole.indices).toHaveLength(36);
    expect(open.positions.length / 3).toBe(20);
    const geometry = detailGeometry(whole);
    const normals = geometry.getAttribute("normal") as BufferAttribute;
    const position = geometry.getAttribute("position") as BufferAttribute;
    for (let vertex = 0; vertex < position.count; vertex++) {
      const outward = new Vector3()
        .fromBufferAttribute(position, vertex)
        .sub(new Vector3(1, 2, 3));
      expect(
        new Vector3().fromBufferAttribute(normals, vertex).dot(outward),
      ).toBeGreaterThan(0);
    }
  });

  it("winds every triangle toward its normal, for boxes turned any way", () => {
    const buffers = createDetailBuffers();
    for (const angle of [0, 0.7, 2.4, -1.9]) {
      pushDetailBox(buffers, {
        centre: [0, 0, 0],
        axes: axesAlong([Math.cos(angle), Math.sin(angle)]),
        size: [1, 2, 3],
        colour: 0x123456,
      });
    }
    const geometry = detailGeometry(buffers);
    const normals = geometry.getAttribute("normal") as BufferAttribute;
    const index = geometry.getIndex()!;
    faceNormals(geometry).forEach((face, triangle) => {
      const vertexNormal = new Vector3().fromBufferAttribute(
        normals,
        index.getX(triangle * 3),
      );
      expect(face.dot(vertexNormal)).toBeGreaterThan(0.99);
    });
  });
});

describe("pushDetailQuad", () => {
  it("stores the colour in linear space, as vertex colours expect", () => {
    const buffers = createDetailBuffers();

    pushDetailQuad(
      buffers,
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ],
      [0, 0, 1],
      0x80c040,
    );

    const linear = new Color(0x80c040);
    expect(buffers.colours.slice(0, 3)).toEqual([linear.r, linear.g, linear.b]);
    expect(buffers.colours).toHaveLength(12);
  });
});
