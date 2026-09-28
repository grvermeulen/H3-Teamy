import { describe, expect, it } from "vitest";
import { pedLookName } from "../sim/peds";
import {
  LOOKS,
  pedLookOf,
  vestColour,
  type CharacterLook,
  type Extra,
} from "./characterLooks";

const ALL_LOOKS: CharacterLook[] = [
  "player",
  "otherPlayer",
  "ped1",
  "ped2",
  "ped3",
  "ped4",
  "ped5",
  "ped6",
  "cop",
];

function extraKinds(look: CharacterLook): Extra["kind"][] {
  return LOOKS[look].extras.map((extra) => extra.kind);
}

describe("pedLookOf", () => {
  it("follows the 2D pedestrian look, id % 6", () => {
    expect(pedLookOf(7)).toBe("ped2");
    expect(pedLookOf(0)).toBe("ped1");
    expect(pedLookOf(11)).toBe("ped6");
  });

  it.each([-7, -1, 3, 42, 1001])(
    "agrees with the 2D sprites for id %i",
    (id) => {
      expect(pedLookOf(id)).toBe(pedLookName(id));
    },
  );
});

describe("LOOKS", () => {
  it("describes every look", () => {
    expect(Object.keys(LOOKS).sort()).toEqual([...ALL_LOOKS].sort());
  });

  it("makes the player a tall, broad, bald man with red shades and mint shorts", () => {
    const player = LOOKS.player;
    expect(player.build).toBe("broad");
    expect(player.height).toBe(1.85);
    expect(player.hair.style).toBe("bald");
    expect(player.bottom.colour).toBe(0x9fe0c4);
    expect(player.shoes).toBe(player.skin);
    const shades = player.extras.find((extra) => extra.kind === "sunglasses");
    expect(shades).toMatchObject({ lens: 0x7a1010 });
    expect(extraKinds("player")).toEqual(
      expect.arrayContaining(["goatee", "bracelet", "tattoo"]),
    );
  });

  it("gives other players the player's build plus a vest", () => {
    const other = LOOKS.otherPlayer;
    expect(other.build).toBe(LOOKS.player.build);
    expect(other.height).toBe(LOOKS.player.height);
    expect(other.skin).toBe(LOOKS.player.skin);
    expect(extraKinds("otherPlayer")).toContain("vest");
  });

  it("puts the cop in neon-yellow bands and a peaked cap", () => {
    const bands = LOOKS.cop.extras.find((extra) => extra.kind === "bands");
    expect(bands).toMatchObject({ colour: 0xd7ff1f });
    expect(extraKinds("cop")).toEqual(
      expect.arrayContaining(["policeCap", "holster"]),
    );
  });

  it("dresses each pedestrian after its sprite", () => {
    expect(extraKinds("ped1")).toContain("backpack");
    expect(extraKinds("ped2")).toContain("flatCap");
    expect(extraKinds("ped3")).toContain("hood");
    expect(extraKinds("ped4")).toContain("hood");
    expect(extraKinds("ped5")).toContain("collar");
    expect(LOOKS.ped6.hair.style).toBe("ponytail");
  });

  it("keeps everyone else at 1.8 m", () => {
    for (const look of ALL_LOOKS) {
      if (look === "player" || look === "otherPlayer") continue;
      expect(LOOKS[look].height).toBe(1.8);
    }
  });
});

describe("vestColour", () => {
  it("turns distinct hues into distinct saturated colours", () => {
    const red = vestColour(0);
    const blue = vestColour(0.6);
    expect(red).not.toBe(blue);
    expect((red >> 16) & 0xff).toBeGreaterThan(red & 0xff);
    expect(blue & 0xff).toBeGreaterThan((blue >> 16) & 0xff);
  });

  it("wraps hues outside one turn", () => {
    expect(vestColour(1.25)).toBe(vestColour(0.25));
  });
});
