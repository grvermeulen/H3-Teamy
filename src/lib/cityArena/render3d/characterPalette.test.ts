import { ShaderLib, type Mesh } from "three";
import { describe, expect, it } from "vitest";
import { PALETTE_SLOTS } from "../characterManifest";
import {
  createAccessory,
  disposeAccessoryGeometries,
} from "./characterAccessories";
import {
  createPaletteMaterial,
  hidePaletteSlot,
  writePaletteSlot,
} from "./characterPalette";

/** Runs a material's shader hook over the Lambert shader. */
function compiled(
  material: ReturnType<typeof createPaletteMaterial>["material"],
) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.lambert.vertexShader,
    fragmentShader: ShaderLib.lambert.fragmentShader,
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

describe("createPaletteMaterial", () => {
  it("colours each vertex from its slot's entry in the material's own table", () => {
    const { material, colours } = createPaletteMaterial();
    const shader = compiled(material);
    expect(shader.uniforms.paletteColours.value).toBe(colours);
    expect(colours).toHaveLength(PALETTE_SLOTS * 3);
    expect(shader.vertexShader).toContain("attribute float _palette;");
    expect(shader.vertexShader).toContain(
      "paletteColours[int(_palette + 0.5)]",
    );
    expect(shader.fragmentShader).toContain("diffuse * vPaletteColour");
  });

  it("shares one program between characters but not their colours", () => {
    const first = createPaletteMaterial();
    const second = createPaletteMaterial();
    expect(first.material.customProgramCacheKey()).toBe(
      second.material.customProgramCacheKey(),
    );
    expect(first.colours).not.toBe(second.colours);
  });
});

describe("writePaletteSlot", () => {
  it("stores an sRGB colour as linear RGB in its slot", () => {
    const colours = new Float32Array(PALETTE_SLOTS * 3);
    writePaletteSlot(colours, 2, 0xff8000);
    expect(colours[6]).toBeCloseTo(1);
    expect(colours[7]).toBeCloseTo(0.2158, 3);
    expect(colours[8]).toBe(0);
  });
});

describe("hidePaletteSlot", () => {
  it("marks a slot hidden, which the shader sends past the far plane", () => {
    const colours = new Float32Array(PALETTE_SLOTS * 3).fill(1);
    hidePaletteSlot(colours, 1);
    expect(colours[3]).toBeLessThan(0);
    const shader = compiled(createPaletteMaterial().material);
    expect(shader.vertexShader).toContain("if (vPaletteColour.r < 0.0)");
  });
});

describe("createAccessory", () => {
  it("hangs glasses on the head and a backpack on the chest, sharing geometry", () => {
    const glasses = createAccessory(
      { kind: "glasses", colour: 0x111111 },
      false,
    );
    const again = createAccessory({ kind: "glasses", colour: 0x111111 }, false);
    const backpack = createAccessory(
      { kind: "backpack", colour: 0xa3282a },
      true,
    );
    expect(glasses.bone).toBe("Head");
    expect(backpack.bone).toBe("Chest");
    expect((glasses.object.children[0] as Mesh).geometry).toBe(
      (again.object.children[0] as Mesh).geometry,
    );
    disposeAccessoryGeometries();
  });

  it("draws the player's lenses unlit", () => {
    const shades = createAccessory(
      { kind: "sunglasses", colour: 0x7a1010 },
      false,
    );
    expect(shades.object.children).toHaveLength(2);
    expect((shades.object.children[1] as Mesh).material).toHaveProperty(
      "type",
      "MeshBasicMaterial",
    );
    disposeAccessoryGeometries();
  });
});
