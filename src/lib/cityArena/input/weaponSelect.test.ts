import { describe, expect, it } from "vitest";
import { EMPTY_INPUT, type WeaponKind } from "../sim/types";
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
) {
  let held = start;
  let wasPressed = false;
  const trace: boolean[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const input = selector.apply(EMPTY_INPUT, held);
    trace.push(input.weaponNext);
    if (input.weaponNext && !wasPressed) {
      let next = held;
      do next = RACK[(RACK.indexOf(next) + 1) % RACK.length]!;
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

  it("gives up on a weapon the simulation will not switch to", () => {
    const selector = createWeaponSelector();
    selector.request("shotgun");
    const { trace } = simulate(selector, "pistol", 40, ["shotgun"]);
    // Two laps of the six-weapon rack: twelve presses, a tick each with a release between.
    expect(trace.slice(0, 24).filter(Boolean)).toHaveLength(12);
    expect(trace.slice(24).some(Boolean)).toBe(false);
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
