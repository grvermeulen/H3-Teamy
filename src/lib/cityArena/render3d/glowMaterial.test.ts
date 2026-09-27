import {
  AdditiveBlending,
  Color,
  DoubleSide,
  FrontSide,
  NormalBlending,
} from "three";
import { describe, expect, it } from "vitest";
import { createGlowMaterial, glowAlpha, linearFogFactor } from "./glowMaterial";

describe("createGlowMaterial", () => {
  it("adds its light from both sides without writing depth, and takes the scene's fog", () => {
    const glow = createGlowMaterial({ colour: 0x22d3ee, opacity: 0.6 });

    expect(glow.blending).toBe(AdditiveBlending);
    expect(glow.side).toBe(DoubleSide);
    expect(glow.transparent).toBe(true);
    expect(glow.depthWrite).toBe(false);
    expect(glow.depthTest).toBe(true);
    expect(glow.fog).toBe(true);
    expect(glow.uniforms.fogNear).toBeDefined();
  });

  it("shows the 2D marker colours as they are, untouched by tone mapping", () => {
    const glow = createGlowMaterial({ colour: 0xf3cf68, opacity: 0.5 });

    expect(glow.toneMapped).toBe(false);
    expect(glow.fragmentShader).not.toContain("<tonemapping_fragment>");
  });

  it("blends normally when asked, for a core that keeps its colour over a bright sky", () => {
    const glow = createGlowMaterial({
      colour: 0xf3cf68,
      opacity: 0.8,
      blending: NormalBlending,
    });

    expect(glow.blending).toBe(NormalBlending);
    expect(createGlowMaterial({ colour: 0, opacity: 1 }).blending).toBe(
      AdditiveBlending,
    );
  });

  it("works out its strength as its shader does: fades up, across and into the fog", () => {
    const shape = { opacity: 0.8, riseFade: 2, acrossFade: 1, fogShare: 0.5 };
    const glow = createGlowMaterial({ colour: 0, ...shape });

    expect(glowAlpha(shape, 0.25, 0.5, 0.4)).toBeCloseTo(
      0.8 * 0.5 ** 2 * 0.5 * (1 - 0.5 * 0.4),
    );
    expect(glow.uniforms.uFogShare.value).toBe(0.5);
    expect(glow.fragmentShader).toContain(
      "alpha *= 1.0 - uFogShare * fogFactor",
    );
  });

  it("gives all of itself to the fog unless told to keep some", () => {
    expect(glowAlpha({ opacity: 1 }, 0.5, 0, 1)).toBe(0);
    expect(glowAlpha({ opacity: 1, fogShare: 0 }, 0.5, 0, 1)).toBe(1);
    expect(
      createGlowMaterial({ colour: 0, opacity: 1 }).uniforms.uFogShare.value,
    ).toBe(1);
  });

  it("reads the fog as three.js's linear fog does: clear before it starts, gone at its end", () => {
    expect(linearFogFactor(50, 100, 300)).toBe(0);
    expect(linearFogFactor(200, 100, 300)).toBeCloseTo(0.5);
    expect(linearFogFactor(400, 100, 300)).toBe(1);
  });

  it("glows from its front faces only when asked", () => {
    const glow = createGlowMaterial({
      colour: 0xf3cf68,
      opacity: 0.5,
      side: FrontSide,
    });

    expect(glow.side).toBe(FrontSide);
  });

  it("starts in its colour and strength, even until told to fade", () => {
    const glow = createGlowMaterial({ colour: 0x22d3ee, opacity: 0.6 });

    expect(glow.uniforms.uColour.value.toArray()).toEqual(
      new Color(0x22d3ee).toArray(),
    );
    expect(glow.uniforms.uOpacity.value).toBe(0.6);
    expect(glow.uniforms.uRiseFade.value).toBe(0);
    expect(glow.uniforms.uAcrossFade.value).toBe(0);
  });

  it("fades up and across as asked, and fades out in the fog rather than taking its colour", () => {
    const glow = createGlowMaterial({
      colour: "#fde047",
      opacity: 1,
      riseFade: 1.5,
      acrossFade: 0.8,
    });

    expect(glow.uniforms.uRiseFade.value).toBe(1.5);
    expect(glow.uniforms.uAcrossFade.value).toBe(0.8);
    expect(glow.fragmentShader).toContain("fogFactor");
    expect(glow.fragmentShader).not.toContain("<fog_fragment>");
  });
});
