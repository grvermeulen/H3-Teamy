import { describe, expect, it } from "vitest";
import { EMPTY_INPUT, type WeaponKind } from "../sim/types";
import { WEAPON_ORDER } from "../sim/weapons";
import { SLOT_WEAPONS, createWeaponSelector } from "./weaponSelect";

/** The rack in the order the simulation cycles it. */
const RACK: WeaponKind[] = ["fist", "pistol", "uzi", "shotgun"];

/**
 * A stand-in for the simulation's weapon switch: the held weapon moves one along the rack on
 * every rising edge of `weaponNext`, skipping `empty` weapons the way the real switch skips
 * weapons with no ammo.
 */
function simulate(
  selector: ReturnType<typeof createWeaponSelector>,
  start: WeaponKind,
  ticks: number,
  empty: WeaponKind[] = [],
  rack: readonly WeaponKind[] = RACK,
) {
  let held = start;
  let wasPressed = false;
  const trace: boolean[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const input = selector.apply(EMPTY_INPUT, held);
    trace.push(input.weaponNext);
    if (input.weaponNext && !wasPressed) {
      let next = held;
      do next = rack[(rack.indexOf(next) + 1) % rack.length]!;
      while (empty.includes(next) && next !== held);
      held = next;
    }
    wasPressed = input.weaponNext;
  }
  return { held, trace };
}

describe("createWeaponSelector", () => {
  it("passes the live input through while nothing is pending", () => {
    const selector = createWeaponSelector();
    const live = { ...EMPTY_INPUT, weaponNext: true };
    expect(selector.apply(live, "pistol")).toBe(live);
  });

  it("presses and releases until the player holds what was asked for", () => {
    const selector = createWeaponSelector();
    selector.request(SLOT_WEAPONS[3]);
    const { held, trace } = simulate(selector, "pistol", 8);
    expect(held).toBe("shotgun");
    // Two edges (pistol → uzi → shotgun), each a press then a release, then quiet.
    expect(trace).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("gives up on a weapon the simulation will not switch to once the cycle is back at the start", () => {
    const selector = createWeaponSelector();
    selector.request("shotgun");
    const { held, trace } = simulate(selector, "pistol", 40, ["shotgun"]);
    // pistol → uzi → (shotgun skipped) fist → pistol: three presses, then quiet, back on the pistol.
    expect(held).toBe("pistol");
    expect(trace.filter(Boolean)).toHaveLength(3);
    expect(trace.slice(6).some(Boolean)).toBe(false);
  });

  it.each([
    {
      pick: "rocket",
      carried: ["uzi"],
      why: "slot 6 with no rockets",
    },
    {
      pick: "rocket",
      carried: ["uzi", "shotgun"],
      why: "slot 6 with no rockets, uzi and shotgun carried",
    },
    { pick: "rifle", carried: ["uzi"], why: "slot 4 with no rifle" },
  ] as const)("leaves the uzi in hand after $why", ({ pick, carried }) => {
    const empty = WEAPON_ORDER.filter(
      (kind) =>
        kind !== "fist" &&
        kind !== "pistol" &&
        !(carried as readonly WeaponKind[]).includes(kind),
    );
    const selector = createWeaponSelector();
    selector.request(pick);
    const { held, trace } = simulate(selector, "uzi", 40, empty, WEAPON_ORDER);
    expect(held).toBe("uzi");
    expect(trace.slice(-10).some(Boolean)).toBe(false);
  });

  it("stops after two laps of presses when the held weapon never moves", () => {
    const selector = createWeaponSelector();
    selector.request("shotgun");
    const { held, trace } = simulate(selector, "pistol", 40, [
      "fist",
      "uzi",
      "shotgun",
    ]);
    // The backstop: fourteen presses (two laps of the seven-weapon rack), then quiet.
    expect(held).toBe("pistol");
    expect(trace.slice(0, 28).filter(Boolean)).toHaveLength(14);
    expect(trace.slice(28).some(Boolean)).toBe(false);
  });

  it("reaches the rocket launcher on slot 6, at the end of the real rack", () => {
    expect(SLOT_WEAPONS[6]).toBe("rocket");
    const selector = createWeaponSelector();
    selector.request(SLOT_WEAPONS[6]);
    expect(simulate(selector, "fist", 16, [], WEAPON_ORDER).held).toBe(
      "rocket",
    );
  });

  it("does nothing for the weapon already held", () => {
    const selector = createWeaponSelector();
    selector.request("pistol");
    const { trace } = simulate(selector, "pistol", 4);
    expect(trace.some(Boolean)).toBe(false);
  });

  it("cycles exactly once per notch, and a notch replaces a pending pick", () => {
    const selector = createWeaponSelector();
    selector.cycle();
    expect(simulate(selector, "pistol", 4)).toEqual({
      held: "uzi",
      trace: [true, false, false, false],
    });
    selector.request("shotgun");
    selector.cycle();
    // The pick was dropped in favour of the single notch.
    expect(simulate(selector, "fist", 6).held).toBe("pistol");
  });
});
