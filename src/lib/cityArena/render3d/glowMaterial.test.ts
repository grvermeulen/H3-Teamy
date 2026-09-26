import { AdditiveBlending, Color, DoubleSide, FrontSide } from "three";
import { describe, expect, it } from "vitest";
import { createGlowMaterial } from "./glowMaterial";

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
    expect(glow.fragmentShader).toContain("alpha *= 1.0 - fogFactor");
    expect(glow.fragmentShader).not.toContain("<fog_fragment>");
  });
});
