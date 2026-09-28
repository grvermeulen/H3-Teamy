import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  FrontSide,
  Group,
  Mesh,
  NormalBlending,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import {
  BEACON_CORE,
  BEACON_CORE_RADIUS_M,
  BEACON_FOG_SHARE,
  BEACON_FULL_WIDTH_M,
  BEACON_GLOW,
  BEACON_HEIGHT_M,
  BEACON_MIN_REACH_M,
  BEACON_PULSE_S,
  BEACON_PULSE_SHARE,
  BEACON_RADIUS_M,
  beaconPulse,
  beaconReach,
  beaconWidthScale,
  createBeacons3d,
} from "./beacons3d";
import { glowAlpha, linearFogFactor, type GlowMaterial } from "./glowMaterial";
import type { BeaconSpot } from "./missionMarkers";
import { HORIZON_GLOW } from "./palette3d";
import { FOG_NEAR_SHARE } from "./renderer3d";

const FOCUS = { x: 0, y: 0 };
const VIEW_M = 380;
const GOLD: BeaconSpot = { x: 30, y: -40, colour: 0xf3cf68 };

function shown(beacons: ReturnType<typeof createBeacons3d>): Group[] {
  return beacons.object.children.filter(
    (child): child is Group => child instanceof Group && child.visible,
  );
}

function layer(beacon: Group, name: "beaconCore" | "beaconGlow"): Mesh {
  return beacon.getObjectByName(name) as Mesh;
}

function glowOf(mesh: Mesh): GlowMaterial {
  return mesh.material as GlowMaterial;
}

/** A beacon layer's strength at its foot, in the fog of a city drawn to `viewDistance`. */
function footAlpha(
  shape: typeof BEACON_CORE,
  distance: number,
  viewDistance: number,
): number {
  const fog = linearFogFactor(
    distance,
    viewDistance * FOG_NEAR_SHARE,
    viewDistance,
  );
  return glowAlpha(shape, 0.5, 0, fog);
}

/** sRGB 0..1 channels of a hex colour. */
function srgb(hex: number): number[] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(
    (channel) => channel / 255,
  );
}

describe("beaconPulse", () => {
  it("swells and eases gently around full strength, once per period", () => {
    expect(BEACON_PULSE_SHARE).toBeLessThanOrEqual(0.3);
    expect(beaconPulse(0)).toBeCloseTo(1);
    expect(beaconPulse(BEACON_PULSE_S / 4)).toBeCloseTo(1 + BEACON_PULSE_SHARE);
    expect(beaconPulse((BEACON_PULSE_S * 3) / 4)).toBeCloseTo(
      1 - BEACON_PULSE_SHARE,
    );
    expect(beaconPulse(BEACON_PULSE_S)).toBeCloseTo(1);
  });
});

describe("beacon strength and reach (Ruling 32)", () => {
  it("keeps most of a beacon in the fog that swallows the city 300 m away", () => {
    for (const shape of [BEACON_CORE, BEACON_GLOW]) {
      const clear = glowAlpha(shape, 0.5, 0, 0);
      expect(footAlpha(shape, 300, VIEW_M)).toBeGreaterThan(0.8 * clear);
      expect(footAlpha(shape, VIEW_M, VIEW_M)).toBeCloseTo(
        clear * (1 - BEACON_FOG_SHARE),
      );
    }
    const city = 1 - linearFogFactor(300, VIEW_M * FOG_NEAR_SHARE, VIEW_M);
    expect(city).toBeLessThan(0.3);
  });

  it("has a strong, narrow core inside a wider, softer glow", () => {
    expect(BEACON_CORE_RADIUS_M).toBeLessThan(BEACON_RADIUS_M / 2);
    expect(BEACON_CORE.opacity).toBeGreaterThan(BEACON_GLOW.opacity);
    expect(glowAlpha(BEACON_CORE, 0.5, 0.5, 0)).toBeGreaterThan(
      glowAlpha(BEACON_GLOW, 0.5, 0.5, 0),
    );
  });

  it("keeps the core's colour over the bright horizon band far better than added light", () => {
    const gold = srgb(GOLD.colour);
    const horizon = srgb(HORIZON_GLOW);
    const over = gold.map(
      (channel, index) =>
        horizon[index]! * (1 - BEACON_CORE.opacity) +
        channel * BEACON_CORE.opacity,
    );
    const added = gold.map((channel, index) =>
      Math.min(1, horizon[index]! + channel * BEACON_CORE.opacity),
    );
    const apart = (a: number[], b: number[]): number =>
      Math.hypot(...a.map((value, index) => value - b[index]!));

    expect(apart(over, gold)).toBeLessThan(0.1);
    expect(apart(over, gold)).toBeLessThan(apart(added, gold) / 3);
  });

  it("reaches 450 m whatever the quality, and the city's edge beyond that", () => {
    expect(BEACON_MIN_REACH_M).toBe(450);
    expect(beaconReach(260)).toBe(BEACON_MIN_REACH_M);
    expect(beaconReach(520)).toBe(520);
  });

  it("widens a far beacon so it keeps its width on screen", () => {
    expect(beaconWidthScale(0)).toBe(1);
    expect(beaconWidthScale(BEACON_FULL_WIDTH_M)).toBe(1);
    expect(beaconWidthScale(300)).toBeCloseTo(300 / BEACON_FULL_WIDTH_M);
  });
});

describe("createBeacons3d", () => {
  it("raises a 30 m column over each spot: a normal-blended core in a wide additive glow", () => {
    expect(BEACON_RADIUS_M).toBe(1.2);
    expect(BEACON_HEIGHT_M).toBe(30);
    const beacons = createBeacons3d();

    beacons.update([GOLD], FOCUS, VIEW_M, 0);

    const [column] = shown(beacons);
    expect(column!.position.toArray()).toEqual([30, 0, -40]);
    const core = layer(column!, "beaconCore");
    const glow = layer(column!, "beaconGlow");
    const glowShape = glow.geometry as CylinderGeometry;
    expect(glowShape.parameters.radiusTop).toBe(BEACON_RADIUS_M);
    expect((core.geometry as CylinderGeometry).parameters.radiusTop).toBe(
      BEACON_CORE_RADIUS_M,
    );
    glowShape.computeBoundingBox();
    expect(glowShape.boundingBox!.getSize(new Vector3()).y).toBeCloseTo(
      BEACON_HEIGHT_M,
    );
    expect(glowShape.boundingBox!.min.y).toBeCloseTo(0);
    expect(glowOf(glow).blending).toBe(AdditiveBlending);
    expect(glowOf(core).blending).toBe(NormalBlending);
    expect(core.renderOrder).toBeGreaterThan(glow.renderOrder);
    for (const part of [core, glow]) {
      expect(glowOf(part).side).toBe(FrontSide);
      expect(glowOf(part).uniforms.uFogShare.value).toBe(BEACON_FOG_SHARE);
      expect(glowOf(part).uniforms.uColour.value.toArray()).toEqual(
        new Color(GOLD.colour).toArray(),
      );
    }
  });

  it("stands a beacon 300 m away on the lowest quality, and none beyond its reach", () => {
    const beacons = createBeacons3d();
    const far = { ...GOLD, x: BEACON_MIN_REACH_M + 1, y: 0 };

    beacons.update([{ ...GOLD, x: 300, y: 0 }, far], FOCUS, 260, 0);

    expect(shown(beacons)).toHaveLength(1);
    expect(shown(beacons)[0]!.position.x).toBe(300);
  });

  it("widens the column of a far beacon, and not of a near one", () => {
    const beacons = createBeacons3d();

    beacons.update([GOLD, { ...GOLD, x: 300, y: 0 }], FOCUS, VIEW_M, 0);

    const [near, far] = shown(beacons);
    expect(near!.scale.toArray()).toEqual([1, 1, 1]);
    expect(far!.scale.x).toBeCloseTo(beaconWidthScale(300));
    expect(far!.scale.y).toBe(1);
  });

  it("reuses its columns frame to frame and hides the spare ones", () => {
    const beacons = createBeacons3d();
    const blue: BeaconSpot = { x: -20, y: 5, colour: 0x94abd8 };
    beacons.update([GOLD, blue], FOCUS, VIEW_M, 0);
    const built = [...beacons.object.children];

    beacons.update([blue], FOCUS, VIEW_M, 0.1);
    expect(shown(beacons)).toHaveLength(1);
    const core = layer(shown(beacons)[0]!, "beaconCore");
    expect(glowOf(core).uniforms.uColour.value.getHex()).toBe(0x94abd8);
    beacons.update([GOLD, blue], FOCUS, VIEW_M, 0.2);

    expect(beacons.object.children).toEqual(built);
    expect(shown(beacons)).toHaveLength(2);
  });

  it("pulses each layer's strength with the clock", () => {
    const beacons = createBeacons3d();
    beacons.update([GOLD], FOCUS, VIEW_M, 0);
    const [column] = shown(beacons);
    const core = glowOf(layer(column!, "beaconCore"));
    const glow = glowOf(layer(column!, "beaconGlow"));
    expect(core.uniforms.uOpacity.value).toBeCloseTo(BEACON_CORE.opacity);

    beacons.update([GOLD], FOCUS, VIEW_M, BEACON_PULSE_S / 4);

    expect(core.uniforms.uOpacity.value).toBeCloseTo(
      BEACON_CORE.opacity * (1 + BEACON_PULSE_SHARE),
    );
    expect(glow.uniforms.uOpacity.value).toBeCloseTo(
      BEACON_GLOW.opacity * (1 + BEACON_PULSE_SHARE),
    );
  });

  it("frees both column shapes and every layer's material", () => {
    const beacons = createBeacons3d();
    beacons.update([GOLD, { ...GOLD, x: 0 }], FOCUS, VIEW_M, 0);
    const layers = shown(beacons).flatMap((column) => [
      layer(column, "beaconCore"),
      layer(column, "beaconGlow"),
    ]);
    const geometries = [layers[0]!.geometry, layers[1]!.geometry].map(
      (geometry) => vi.spyOn(geometry, "dispose"),
    );
    const materials = layers.map((part) => vi.spyOn(glowOf(part), "dispose"));

    beacons.dispose();

    expect(layers[0]!.geometry).toBe(layers[2]!.geometry);
    for (const spy of [...geometries, ...materials])
      expect(spy).toHaveBeenCalledOnce();
  });
});
