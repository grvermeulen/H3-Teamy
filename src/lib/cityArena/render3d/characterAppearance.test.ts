import { describe, expect, it } from "vitest";
import { CHARACTER_MODEL_KEYS } from "../characterManifest";
import {
  APPEARANCE_SCALE_MAX,
  APPEARANCE_SCALE_MIN,
  MODEL_SLOT_ROLES,
  SKIN_TONES,
  appearanceKey,
  appearanceOf,
  modelOf,
} from "./characterAppearance";
import { vestColour } from "./characterLooks";

/** Ids 0…199. */
const IDS = Array.from({ length: 200 }, (_, index) => index);

describe("appearanceOf", () => {
  it("gives the same pedestrian the same appearance every time", () => {
    expect(appearanceOf("ped3", 42)).toEqual(appearanceOf("ped3", 42));
  });

  it("dresses at least 40 of 200 pedestrians differently", () => {
    const keys = new Set(
      IDS.map((id) => appearanceKey(appearanceOf("ped1", id))),
    );
    expect(keys.size).toBeGreaterThanOrEqual(40);
  });

  it("spreads the pedestrians over all eight skin tones", () => {
    const tones = new Set(
      IDS.map((id) => appearanceOf("ped2", id).tints["Head/Skin"]),
    );
    expect(tones).toEqual(new Set(SKIN_TONES));
  });

  it("never dresses a pedestrian as an officer, and uses most of the city set", () => {
    const models = new Set(IDS.map((id) => appearanceOf("ped4", id).model));
    expect(models.has("swat")).toBe(false);
    expect(models.size).toBe(CHARACTER_MODEL_KEYS.length - 1);
  });

  it("keeps every pedestrian's height within bounds", () => {
    for (const id of IDS) {
      const { scale } = appearanceOf("ped5", id);
      expect(scale).toBeGreaterThanOrEqual(APPEARANCE_SCALE_MIN);
      expect(scale).toBeLessThanOrEqual(APPEARANCE_SCALE_MAX);
    }
  });

  it("dresses the player as the bald beach man in red shades and mint shorts", () => {
    for (const id of [0, 7, 1234]) {
      const player = appearanceOf("player", id);
      expect(player.model).toBe("beach-man");
      expect(player.scale).toBe(1);
      expect(player.hidden).toEqual(["Hair"]);
      expect(player.tints.Red_Dark).toBe(0x9fe0c4);
      expect(player.extras.map((extra) => extra.kind)).toEqual(
        expect.arrayContaining(["sunglasses", "bracelet"]),
      );
      const shades = player.extras.find((extra) => extra.kind === "sunglasses");
      expect(shades?.colour).toBe(0x7a1010);
    }
  });

  it("puts every officer in the SWAT model in police navy", () => {
    for (const id of IDS.slice(0, 20)) {
      const cop = appearanceOf("cop", id);
      expect(cop.model).toBe("swat");
      expect(cop.tints.Swat).toBe(0x1f2a4c);
    }
  });

  it("wears another player's vest hue on the top", () => {
    const other = appearanceOf("otherPlayer", 3, 0.1);
    const [topSlot] = Object.entries(MODEL_SLOT_ROLES[other.model]).find(
      ([, role]) => role === "top",
    ) ?? [""];
    expect(other.tints[topSlot]).toBe(vestColour(0.1));
  });

  it("tints only slots the model has", () => {
    for (const id of IDS.slice(0, 50)) {
      const { model, tints } = appearanceOf("ped6", id);
      for (const slot of Object.keys(tints))
        expect(Object.keys(MODEL_SLOT_ROLES[model])).toContain(slot);
    }
  });
});

describe("modelOf", () => {
  it("agrees with the appearance without building it", () => {
    for (const id of IDS.slice(0, 30))
      for (const look of ["ped1", "player", "cop", "otherPlayer"] as const)
        expect(modelOf(look, id)).toBe(appearanceOf(look, id).model);
  });
});
