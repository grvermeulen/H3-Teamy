import { AdditiveBlending, Color, type BufferAttribute } from "three";
import { describe, expect, it, vi } from "vitest";
import { ZONE_RGB } from "../render/palette";
import { MAP_UNITS_PER_METRE, type MapZone } from "../world/mapTypes";
import type { GlowMaterial } from "./glowMaterial";
import {
  ZONE_WALL_HEIGHT_M,
  ZONE_WALL_REACH_M,
  createZoneWall3d,
  zoneArc,
  type ZoneArc,
} from "./zoneWall3d";

const CENTRE = { x: 500, y: 500 };

function arc(): ZoneArc {
  return { start: 0, sweep: 0 };
}

/** A zone of `radius` metres around {@link CENTRE}. */
function zone(radius: number): MapZone {
  return {
    key: "wageningen",
    name: "Wageningen",
    center: [CENTRE.x * MAP_UNITS_PER_METRE, CENTRE.y * MAP_UNITS_PER_METRE],
    radius: radius * MAP_UNITS_PER_METRE,
    spawnNodes: [],
    landmarks: [],
  } as MapZone;
}

/** Distance from `from` to the circle's point at `angle`. */
function reachTo(
  radius: number,
  angle: number,
  from: { x: number; y: number },
): number {
  return Math.hypot(
    CENTRE.x + Math.cos(angle) * radius - from.x,
    CENTRE.y + Math.sin(angle) * radius - from.y,
  );
}

describe("zoneArc", () => {
  it("keeps only the stretch of a big ring within reach, centred on the player's side", () => {
    expect(ZONE_WALL_REACH_M).toBe(150);
    const player = { x: CENTRE.x + 900, y: CENTRE.y };

    const found = zoneArc(CENTRE, 1000, player, ZONE_WALL_REACH_M, arc())!;

    expect(found.start + found.sweep / 2).toBeCloseTo(0);
    expect(reachTo(1000, found.start, player)).toBeCloseTo(150);
    expect(reachTo(1000, found.start + found.sweep, player)).toBeCloseTo(150);
    expect(found.sweep).toBeLessThan(Math.PI / 2);
  });

  it("points the stretch at the player from outside the ring too", () => {
    const player = { x: CENTRE.x, y: CENTRE.y - 1100 };

    const found = zoneArc(CENTRE, 1000, player, ZONE_WALL_REACH_M, arc())!;

    expect(found.start + found.sweep / 2).toBeCloseTo(-Math.PI / 2);
  });

  it("keeps the whole ring when all of it is within reach", () => {
    const found = zoneArc(CENTRE, 60, CENTRE, ZONE_WALL_REACH_M, arc())!;

    expect(found.sweep).toBeCloseTo(Math.PI * 2);
  });

  it("is nothing when no part of the ring is within reach", () => {
    expect(zoneArc(CENTRE, 1000, CENTRE, ZONE_WALL_REACH_M, arc())).toBeNull();
    const far = { x: CENTRE.x + 1400, y: CENTRE.y };
    expect(zoneArc(CENTRE, 1000, far, ZONE_WALL_REACH_M, arc())).toBeNull();
  });

  it("writes into the arc it is given", () => {
    const out = arc();
    const player = { x: CENTRE.x + 950, y: CENTRE.y };
    expect(zoneArc(CENTRE, 1000, player, ZONE_WALL_REACH_M, out)).toBe(out);
  });
});

describe("createZoneWall3d", () => {
  it("glows additively in the 2D ring's blue and fades toward its top", () => {
    const wall = createZoneWall3d();
    const material = wall.object.material as GlowMaterial;
    const blue = new Color(`rgb(${ZONE_RGB.join(",")})`);

    expect(material.blending).toBe(AdditiveBlending);
    expect(material.fog).toBe(true);
    expect(material.uniforms.uColour.value.toArray()).toEqual(blue.toArray());
    expect(material.uniforms.uRiseFade.value).toBeGreaterThan(0);
  });

  it("stands a wall 12 m high along the ring's stretch near the player", () => {
    expect(ZONE_WALL_HEIGHT_M).toBe(12);
    const wall = createZoneWall3d();
    const player = { x: CENTRE.x + 900, y: CENTRE.y };

    wall.update(zone(1000), player);

    expect(wall.object.visible).toBe(true);
    const position = wall.object.geometry.getAttribute(
      "position",
    ) as BufferAttribute;
    let top = 0;
    for (let vertex = 0; vertex < position.count; vertex++) {
      const x = position.getX(vertex) - CENTRE.x;
      const z = position.getZ(vertex) - CENTRE.y;
      expect(Math.hypot(x, z)).toBeCloseTo(1000, 2);
      const reach = Math.hypot(
        position.getX(vertex) - player.x,
        position.getZ(vertex) - player.y,
      );
      expect(reach).toBeLessThanOrEqual(ZONE_WALL_REACH_M + 0.01);
      top = Math.max(top, position.getY(vertex));
    }
    expect(top).toBeCloseTo(ZONE_WALL_HEIGHT_M);
  });

  it("hides without a zone, or with its ring out of reach", () => {
    const wall = createZoneWall3d();
    wall.update(zone(1000), { x: CENTRE.x + 900, y: CENTRE.y });
    wall.update(null, CENTRE);
    expect(wall.object.visible).toBe(false);
    wall.update(zone(1000), CENTRE);
    expect(wall.object.visible).toBe(false);
  });

  it("moves the wall in its own buffers as the player walks, never making new ones", () => {
    const wall = createZoneWall3d();
    wall.update(zone(1000), { x: CENTRE.x + 900, y: CENTRE.y });
    const position = wall.object.geometry.getAttribute("position");
    const firstX = position.getX(0);
    const version = position.version;

    wall.update(zone(1000), { x: CENTRE.x, y: CENTRE.y + 900 });

    expect(wall.object.geometry.getAttribute("position")).toBe(position);
    expect(position.getX(0)).not.toBeCloseTo(firstX);
    expect(position.version).toBeGreaterThan(version);
  });

  it("frees its geometry and material", () => {
    const wall = createZoneWall3d();
    const geometry = vi.spyOn(wall.object.geometry, "dispose");
    const material = vi.spyOn(wall.object.material as GlowMaterial, "dispose");

    wall.dispose();

    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
  });
});
