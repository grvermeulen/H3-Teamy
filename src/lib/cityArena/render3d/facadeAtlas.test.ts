import { describe, expect, it } from "vitest";
import { createFakeContext } from "../render/testing/fakeContext";
import {
  BLOCK_MODULES,
  facadeAtlasSize,
  facadeBlockRect,
  paintFacadeAtlas,
  patchFacadeShader,
  type FacadeBlockKind,
  type FacadeBlockRect,
} from "./facadeAtlas";
import { MODULE_HEIGHT_PX, MODULE_WIDTH_PX, seededLights } from "./facadePaint";
import { FACADE_SHEETS } from "./facadeSheets";

const KINDS: readonly FacadeBlockKind[] = ["upper", "ground", "plain", "shop"];

/** Every distinct block rectangle of the atlas. */
function allRects(): FacadeBlockRect[] {
  const rects = new Map<string, FacadeBlockRect>();
  for (const kind of KINDS)
    FACADE_SHEETS.forEach((_, sheet) => {
      const rect = facadeBlockRect(kind, sheet);
      rects.set(rect.join(), rect);
    });
  return [...rects.values()];
}

/** Whether two rectangles share any area. */
function overlaps(a: FacadeBlockRect, b: FacadeBlockRect): boolean {
  return (
    a[0] < b[0] + b[2] &&
    b[0] < a[0] + a[2] &&
    a[1] < b[1] + b[3] &&
    b[1] < a[1] + a[3]
  );
}

describe("facadeBlockRect", () => {
  it("places every block inside the atlas, apart from every other", () => {
    const rects = allRects();

    expect(rects).toHaveLength(FACADE_SHEETS.length * 3 + 1);
    for (const [u, v, du, dv] of rects) {
      expect(u).toBeGreaterThan(0);
      expect(v).toBeGreaterThan(0);
      expect(u + du).toBeLessThan(1);
      expect(v + dv).toBeLessThan(1);
    }
    rects.forEach((rect, index) =>
      rects
        .slice(index + 1)
        .forEach((other) => expect(overlaps(rect, other)).toBe(false)),
    );
  });

  it("sizes each block to its modules, so a module keeps its shape", () => {
    const { width, height } = facadeAtlasSize();
    for (const kind of KINDS) {
      const [cols, rows] = BLOCK_MODULES[kind];
      const [, , du, dv] = facadeBlockRect(kind, 0);
      const moduleAspect = (du * width) / cols / ((dv * height) / rows);
      expect(moduleAspect).toBeCloseTo(MODULE_WIDTH_PX / MODULE_HEIGHT_PX, 5);
    }
  });

  it("shares one shopfront block between every sheet", () => {
    const shops = new Set(
      FACADE_SHEETS.map((_, sheet) => facadeBlockRect("shop", sheet).join()),
    );

    expect(shops.size).toBe(1);
  });
});

describe("paintFacadeAtlas", () => {
  it("paints the same atlas every time, each block clipped and its gutter wrapped", () => {
    const paint = (): string[] => {
      const context = createFakeContext();
      paintFacadeAtlas(
        context,
        document.createElement("canvas"),
        0.5,
        (inner, kind, sheet, moduleIndex) =>
          inner.fillText(`${kind}:${sheet.key}:${moduleIndex}`, 0, 0),
      );
      return context.calls;
    };

    const first = paint();
    const blocks = FACADE_SHEETS.length * 3 + 1;
    expect(paint()).toEqual(first);
    expect(first.filter((call) => call === "clip()")).toHaveLength(blocks);
    expect(first.filter((call) => call.startsWith("drawImage("))).toHaveLength(
      blocks * 8,
    );
    const modules = KINDS.reduce((sum, kind) => {
      const [cols, rows] = BLOCK_MODULES[kind];
      return sum + cols * rows * (kind === "shop" ? 1 : FACADE_SHEETS.length);
    }, 0);
    expect(first.filter((call) => call.startsWith("fillText("))).toHaveLength(
      modules,
    );
  });
});

describe("patchFacadeShader", () => {
  it("hands the block to the fragment shader and samples both maps inside it", () => {
    const shader = {
      vertexShader:
        "#include <uv_pars_vertex>\nvoid main() {\n#include <uv_vertex>\n}",
      fragmentShader:
        "#include <uv_pars_fragment>\nvoid main() {\n#include <map_fragment>\n#include <emissivemap_fragment>\n}",
    };

    patchFacadeShader(shader);

    expect(shader.vertexShader).toContain("attribute vec4 facadeBlock;");
    expect(shader.vertexShader).toContain("vFacadeBlock = facadeBlock;");
    expect(shader.fragmentShader).toContain("fract( vMapUv )");
    expect(shader.fragmentShader).toContain("textureGrad( map, facadeUv");
    expect(shader.fragmentShader).toContain(
      "textureGrad( emissiveMap, facadeUv",
    );
    expect(shader.fragmentShader).not.toContain("#include <map_fragment>");
  });
});

describe("seededLights", () => {
  it("lights nothing at a share of 0 and everything at 1, the same for the same seed", () => {
    expect(seededLights("a", 40, 0).every((light) => light === null)).toBe(
      true,
    );
    expect(seededLights("a", 40, 1).every((light) => light !== null)).toBe(
      true,
    );
    expect(seededLights("b", 40, 0.4)).toEqual(seededLights("b", 40, 0.4));
  });
});
