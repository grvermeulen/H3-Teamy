import { describe, expect, it } from "vitest";
import { Color, Vector3, type Mesh, type Points } from "three";
import { createSkyDome, setSkyDetail, SKY_RADIUS_M } from "./sky";
import {
  createMoon,
  createStarField,
  MOON_ELEVATION_RAD,
  moonDirection,
  STAR_COUNT,
  STAR_MIN_ELEVATION_RAD,
  starDirection,
} from "./skyDetail";

/** The moonlight's direction, as the renderer sets it. */
const MOON_LIGHT: [number, number, number] = [-120, 300, -80];

/** Each star's position and brightness. */
function starsOf(stars: Points): { at: Vector3; brightness: number }[] {
  const positions = stars.geometry.getAttribute("position");
  const colours = stars.geometry.getAttribute("color");
  return Array.from({ length: positions.count }, (_, index) => ({
    at: new Vector3().fromBufferAttribute(positions, index),
    brightness: new Color()
      .fromBufferAttribute(colours, index)
      .getHSL({ h: 0, s: 0, l: 0 }).l,
  }));
}

describe("createStarField", () => {
  it("puts every star above the horizon, inside the dome", () => {
    const stars = starsOf(createStarField(SKY_RADIUS_M));

    expect(stars).toHaveLength(STAR_COUNT);
    const lowest = SKY_RADIUS_M * Math.sin(STAR_MIN_ELEVATION_RAD) * 0.95;
    for (const { at } of stars) {
      expect(at.y).toBeGreaterThan(lowest);
      expect(at.length()).toBeLessThan(SKY_RADIUS_M);
    }
  });

  it("fades the stars toward the horizon's glow", () => {
    const stars = starsOf(createStarField(SKY_RADIUS_M));
    const mean = (list: typeof stars): number =>
      list.reduce((sum, star) => sum + star.brightness, 0) / list.length;
    const elevation = (star: (typeof stars)[number]): number =>
      Math.asin(star.at.y / star.at.length());

    const low = stars.filter((star) => elevation(star) < 0.15);
    const high = stars.filter((star) => elevation(star) > 0.8);

    expect(low.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(0);
    expect(mean(low)).toBeLessThan(mean(high) / 3);
  });

  it("scatters the same stars every time", () => {
    expect(starDirection(17)).toEqual(starDirection(17));
    expect(starDirection(17)).not.toEqual(starDirection(18));
  });
});

describe("createMoon", () => {
  it("hangs the moon on its light's bearing, low over the rooftops, facing the camera", () => {
    const moon = createMoon(SKY_RADIUS_M, MOON_LIGHT);
    const direction = moon.position.clone().normalize();

    expect(direction.distanceTo(moonDirection(MOON_LIGHT))).toBeLessThan(1e-9);
    expect(Math.asin(direction.y)).toBeCloseTo(MOON_ELEVATION_RAD, 5);
    const bearing = Math.atan2(direction.z, direction.x);
    expect(bearing).toBeCloseTo(Math.atan2(MOON_LIGHT[2], MOON_LIGHT[0]), 5);
    const facing = new Vector3(0, 0, 1).applyQuaternion(moon.quaternion);
    expect(facing.dot(direction)).toBeCloseTo(-1, 5);
  });
});

describe("setSkyDetail", () => {
  it("shows the stars and moon at full detail and hides them at basic", () => {
    const dome = createSkyDome(MOON_LIGHT);
    const names = dome.children.map((child) => child.name).sort();

    setSkyDetail(dome, "basic");
    const hidden = dome.children.every((child) => !child.visible);
    setSkyDetail(dome, "full");

    expect(names).toEqual(["moon", "stars"]);
    expect(hidden).toBe(true);
    expect(dome.children.every((child) => child.visible)).toBe(true);
    expect((dome as Mesh).visible).toBe(true);
  });
});
