import {
  AdditiveBlending,
  Box3,
  Color,
  CylinderGeometry,
  FrontSide,
  Mesh,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import {
  BEACON_HEIGHT_M,
  BEACON_PULSE_S,
  BEACON_PULSE_SHARE,
  BEACON_RADIUS_M,
  beaconPulse,
  createBeacons3d,
} from "./beacons3d";
import type { GlowMaterial } from "./glowMaterial";
import type { BeaconSpot } from "./missionMarkers";

const FOCUS = { x: 0, y: 0 };
const VIEW_M = 380;
const GOLD: BeaconSpot = { x: 30, y: -40, colour: 0xf3cf68 };

function shown(beacons: ReturnType<typeof createBeacons3d>): Mesh[] {
  return beacons.object.children.filter(
    (child): child is Mesh => child instanceof Mesh && child.visible,
  );
}

function glowOf(mesh: Mesh): GlowMaterial {
  return mesh.material as GlowMaterial;
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

describe("createBeacons3d", () => {
  it("raises a 30 m column of 1.2 m radius over each spot, in its colour, fading upward", () => {
    expect(BEACON_RADIUS_M).toBe(1.2);
    expect(BEACON_HEIGHT_M).toBe(30);
    const beacons = createBeacons3d();

    beacons.update([GOLD], FOCUS, VIEW_M, 0);

    const [column] = shown(beacons);
    expect(column!.position.toArray()).toEqual([30, 0, -40]);
    const geometry = column!.geometry as CylinderGeometry;
    expect(geometry.parameters.radiusTop).toBe(BEACON_RADIUS_M);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new Vector3());
    expect(size.y).toBeCloseTo(BEACON_HEIGHT_M);
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0);
    const glow = glowOf(column!);
    expect(glow.blending).toBe(AdditiveBlending);
    expect(glow.uniforms.uRiseFade.value).toBeGreaterThan(0);
    expect(glow.side).toBe(FrontSide);
    expect(glow.uniforms.uColour.value.toArray()).toEqual(
      new Color(GOLD.colour).toArray(),
    );
  });

  it("draws no beacon beyond the view distance", () => {
    const beacons = createBeacons3d();

    beacons.update([GOLD, { ...GOLD, x: VIEW_M + 1, y: 0 }], FOCUS, VIEW_M, 0);

    expect(shown(beacons)).toHaveLength(1);
    expect(new Box3().setFromObject(shown(beacons)[0]!).min.x).toBeLessThan(
      VIEW_M,
    );
  });

  it("reuses its columns frame to frame and hides the spare ones", () => {
    const beacons = createBeacons3d();
    const blue: BeaconSpot = { x: -20, y: 5, colour: 0x94abd8 };
    beacons.update([GOLD, blue], FOCUS, VIEW_M, 0);
    const built = [...beacons.object.children];

    beacons.update([blue], FOCUS, VIEW_M, 0.1);
    expect(shown(beacons)).toHaveLength(1);
    expect(glowOf(shown(beacons)[0]!).uniforms.uColour.value.getHex()).toBe(
      0x94abd8,
    );
    beacons.update([GOLD, blue], FOCUS, VIEW_M, 0.2);

    expect(beacons.object.children).toEqual(built);
    expect(shown(beacons)).toHaveLength(2);
  });

  it("pulses each column's strength with the clock", () => {
    const beacons = createBeacons3d();
    beacons.update([GOLD], FOCUS, VIEW_M, 0);
    const [column] = shown(beacons);
    const rest = glowOf(column!).uniforms.uOpacity.value;

    beacons.update([GOLD], FOCUS, VIEW_M, BEACON_PULSE_S / 4);

    expect(glowOf(column!).uniforms.uOpacity.value).toBeCloseTo(
      rest * (1 + BEACON_PULSE_SHARE),
    );
  });

  it("frees the shared column and every column's material", () => {
    const beacons = createBeacons3d();
    beacons.update([GOLD, { ...GOLD, x: 0 }], FOCUS, VIEW_M, 0);
    const [first, second] = shown(beacons);
    const geometry = vi.spyOn(first!.geometry, "dispose");
    const materials = [first!, second!].map((column) =>
      vi.spyOn(glowOf(column), "dispose"),
    );

    beacons.dispose();

    expect(first!.geometry).toBe(second!.geometry);
    expect(geometry).toHaveBeenCalledOnce();
    for (const material of materials) expect(material).toHaveBeenCalledOnce();
  });
});
