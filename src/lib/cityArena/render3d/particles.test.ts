import { describe, expect, it, vi } from "vitest";
import {
  AdditiveBlending,
  NormalBlending,
  ShaderMaterial,
  Vector4,
  type BufferAttribute,
  type Camera,
  type Scene as ThreeScene,
  type WebGLRenderer,
} from "three";
import { createParticleSystem, type Particle } from "./particles";

/** A particle at rest one metre up, living one second. */
const STILL: Omit<Particle, "life"> = {
  x: 0,
  y: 1,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  maxLife: 1,
  size: 0.5,
  colour: 0xffffff,
  gravity: 0,
  drag: 0,
};

/**
 * The update of the frame the particles were spawned in: it draws them at birth and ages nothing,
 * however long the frame, so the steps after it are what the physics tests measure.
 */
function drawBirth(system: ReturnType<typeof createParticleSystem>): void {
  system.update(1);
}

function attribute(
  system: ReturnType<typeof createParticleSystem>,
  name: string,
): BufferAttribute {
  return system.object.geometry.getAttribute(name) as BufferAttribute;
}

describe("createParticleSystem", () => {
  it("counts spawned particles and expires them after maxLife", () => {
    const system = createParticleSystem(8, false);
    system.spawn({ ...STILL, maxLife: 0.5 });
    system.spawn({ ...STILL, maxLife: 1 });
    expect(system.alive()).toBe(2);
    drawBirth(system);

    system.update(0.4);
    expect(system.alive()).toBe(2);
    system.update(0.2);
    expect(system.alive()).toBe(1);
    system.update(0.5);
    expect(system.alive()).toBe(0);
  });

  it("reuses the slots of expired particles and never grows past capacity", () => {
    const system = createParticleSystem(4, true);
    for (let index = 0; index < 6; index++) system.spawn(STILL);
    expect(system.alive()).toBe(4);
    drawBirth(system);

    system.update(1.1);
    expect(system.alive()).toBe(0);
    for (let index = 0; index < 4; index++)
      system.spawn({ ...STILL, x: index });
    expect(system.alive()).toBe(4);
    expect(attribute(system, "position").array.length).toBe(4 * 3);
  });

  it("keeps the living particles packed at the front and draws only them", () => {
    const system = createParticleSystem(4, false);
    system.spawn({ ...STILL, x: 1, maxLife: 0.2 });
    system.spawn({ ...STILL, x: 2, maxLife: 1 });
    system.spawn({ ...STILL, x: 3, maxLife: 0.2 });
    drawBirth(system);

    system.update(0.3);

    const position = attribute(system, "position");
    expect(system.alive()).toBe(1);
    expect(position.getX(0)).toBeCloseTo(2);
    expect(system.object.geometry.drawRange.count).toBe(1);
  });

  it("pulls a particle down by its gravity and moves it by its velocity", () => {
    const system = createParticleSystem(2, true);
    system.spawn({ ...STILL, y: 10, vx: 2, gravity: 9.8 });
    drawBirth(system);

    system.update(0.1);

    const position = attribute(system, "position");
    expect(position.getX(0)).toBeCloseTo(0.2, 5);
    expect(position.getY(0)).toBeCloseTo(10 - 9.8 * 0.1 * 0.1, 5);
  });

  it("lets a negative gravity lift warm smoke", () => {
    const system = createParticleSystem(2, false);
    system.spawn({ ...STILL, gravity: -1 });
    drawBirth(system);

    system.update(0.5);

    expect(attribute(system, "position").getY(0)).toBeGreaterThan(1);
  });

  it("bleeds speed by its drag rate", () => {
    const system = createParticleSystem(2, false);
    system.spawn({ ...STILL, vx: 10, drag: 2, maxLife: 5 });
    drawBirth(system);

    system.update(1);

    // Drag first: 10·e^-2 m/s for one second.
    expect(attribute(system, "position").getX(0)).toBeCloseTo(
      10 * Math.exp(-2),
      4,
    );
  });

  it("never lets a falling particle sink below the ground", () => {
    const system = createParticleSystem(2, true);
    system.spawn({ ...STILL, y: 0.1, vy: -5, gravity: 9.8 });

    system.update(0.2);

    expect(attribute(system, "position").getY(0)).toBeGreaterThanOrEqual(0);
  });

  it("hands the shader each particle's life share, size and linear colour", () => {
    const system = createParticleSystem(2, false);
    system.spawn({ ...STILL, maxLife: 2, size: 1.5, colour: 0xff0000 });
    drawBirth(system);

    system.update(0.5);

    expect(attribute(system, "aLife").getX(0)).toBeCloseTo(0.25);
    expect(attribute(system, "aSize").getX(0)).toBeCloseTo(1.5);
    const colour = attribute(system, "aColour");
    expect(colour.getX(0)).toBeCloseTo(1);
    expect(colour.getY(0)).toBeCloseTo(0);
  });

  it("draws a particle on the frame it is born, even when that frame outlasts its life", () => {
    const system = createParticleSystem(4, true);
    system.spawn({ ...STILL, x: 5, maxLife: 0.05 });

    system.update(1 / 18);

    expect(system.alive()).toBe(1);
    expect(system.object.geometry.drawRange.count).toBe(1);
    expect(attribute(system, "aLife").getX(0)).toBe(0);
    expect(attribute(system, "position").getX(0)).toBe(5);
    system.update(1 / 18);
    expect(system.alive()).toBe(0);
  });

  it("uploads the buffers after an update that moved something", () => {
    const system = createParticleSystem(2, false);
    const position = attribute(system, "position");
    const before = position.version;
    system.spawn(STILL);

    system.update(0.1);

    expect(position.version).toBeGreaterThan(before);
  });

  it("blends fire additively and smoke normally, both without writing depth", () => {
    const fire = createParticleSystem(2, true).object
      .material as ShaderMaterial;
    const smoke = createParticleSystem(2, false).object
      .material as ShaderMaterial;

    expect(fire.blending).toBe(AdditiveBlending);
    expect(smoke.blending).toBe(NormalBlending);
    expect(fire.depthWrite).toBe(false);
    expect(smoke.depthWrite).toBe(false);
    expect(smoke.fog).toBe(true);
  });

  it("sizes the sprites for the viewport it is drawn into", () => {
    const system = createParticleSystem(2, false);
    const renderer = {
      getCurrentViewport: (target: Vector4) => target.set(0, 0, 1280, 720),
    } as unknown as WebGLRenderer;

    system.object.onBeforeRender(
      renderer,
      {} as ThreeScene,
      {} as Camera,
      system.object.geometry,
      system.object.material as ShaderMaterial,
      null,
    );

    const material = system.object.material as ShaderMaterial;
    expect(material.uniforms.uViewportHeight.value).toBe(720);
  });

  it("frees its geometry and material", () => {
    const system = createParticleSystem(2, false);
    const geometry = vi.spyOn(system.object.geometry, "dispose");
    const material = vi.spyOn(
      system.object.material as ShaderMaterial,
      "dispose",
    );

    system.dispose();

    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
  });
});
