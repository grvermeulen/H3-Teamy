import { describe, expect, it } from "vitest";
import type { PresenceMember, PresenceRole } from "./transport";
import { HOST_SILENCE_MS, createHostWatch, electHost } from "./election";

/** A present member with the fields the election actually reads. */
function member(
  clientId: string,
  role: PresenceRole,
  device: "mobile" | "desktop",
  timestamp: number,
): PresenceMember {
  return {
    clientId,
    data: { name: clientId, colour: "#fff", role, device },
    timestamp,
  };
}

const display = (id: string, at: number) =>
  member(id, "display", "desktop", at);
const desktop = (id: string, at: number) => member(id, "player", "desktop", at);
const mobile = (id: string, at: number) => member(id, "player", "mobile", at);
const controller = (id: string, at: number) =>
  member(id, "controller", "mobile", at);

describe("electHost", () => {
  it("has no host when nobody is present", () => {
    expect(electHost([])).toBeNull();
  });

  it("prefers a display, then a desktop player, then mobile, then a controller", () => {
    const members = [
      controller("d", 1),
      mobile("c", 1),
      desktop("b", 1),
      display("a", 1),
    ];
    expect(electHost(members)).toBe("a");
    expect(electHost(members.filter((m) => m.clientId !== "a"))).toBe("b");
    expect(
      electHost(members.filter((m) => !["a", "b"].includes(m.clientId))),
    ).toBe("c");
    expect(electHost([controller("d", 1)])).toBe("d");
  });

  it("breaks a tie in role on who was present first", () => {
    expect(electHost([desktop("b", 5), desktop("a", 3)])).toBe("a");
  });

  it("breaks a tie in role and time on clientId, so it is a total order", () => {
    // Every member runs this independently and they must all reach the same answer, so the
    // comparison can never fall through to array order.
    const members = [desktop("c", 5), desktop("a", 5), desktop("b", 5)];
    expect(electHost(members)).toBe("a");
    expect(electHost([...members].reverse())).toBe("a");
  });

  it("elects the same host whatever order presence arrives in", () => {
    const members = [mobile("c", 3), desktop("a", 5), desktop("b", 5)];
    expect(electHost(members)).toBe("a");
    expect(electHost([...members].reverse())).toBe("a");
    expect(electHost([members[1]!, members[2]!, members[0]!])).toBe("a");
  });

  it("does not mutate the array it was given", () => {
    const members = [desktop("c", 5), desktop("a", 3)];
    const order = members.map((m) => m.clientId);
    electHost(members);
    expect(members.map((m) => m.clientId)).toEqual(order);
  });
});

describe("createHostWatch", () => {
  it("does not call for a re-election before the silence window", () => {
    const watch = createHostWatch();
    watch.sawSnapshot();
    watch.elapsed(HOST_SILENCE_MS - 1);
    expect(watch.isSilent()).toBe(false);
  });

  it("calls for a re-election once the host has been quiet too long", () => {
    const watch = createHostWatch();
    watch.sawSnapshot();
    watch.elapsed(HOST_SILENCE_MS);
    expect(watch.isSilent()).toBe(true);
  });

  it("a snapshot resets the window", () => {
    const watch = createHostWatch();
    watch.elapsed(HOST_SILENCE_MS - 1);
    watch.sawSnapshot();
    watch.elapsed(HOST_SILENCE_MS - 1);
    expect(watch.isSilent()).toBe(false);
    watch.elapsed(1);
    expect(watch.isSilent()).toBe(true);
  });

  it("counts silence from the start when no snapshot has ever arrived", () => {
    const watch = createHostWatch();
    watch.elapsed(HOST_SILENCE_MS);
    expect(watch.isSilent()).toBe(true);
  });

  it("takes a window of its own when one is given", () => {
    const watch = createHostWatch({ silenceMs: 500 });
    watch.elapsed(499);
    expect(watch.isSilent()).toBe(false);
    watch.elapsed(1);
    expect(watch.isSilent()).toBe(true);
  });
});

describe("electHost with broken presence data", () => {
  it("does not throw when a member arrives with no data at all", () => {
    // Ably can deliver such a member, and election doubles as the authorisation check in
    // recordMatch — a TypeError here would turn a bad presence entry into a 500.
    const nobody = {
      clientId: "ghost",
      data: null,
      timestamp: 1,
    } as unknown as PresenceMember;
    expect(() => electHost([nobody, desktop("a", 2)])).not.toThrow();
  });

  it("ranks a member with no data last, behind every real role", () => {
    const nobody = {
      clientId: "ghost",
      data: undefined,
      timestamp: 1,
    } as unknown as PresenceMember;
    expect(electHost([nobody, controller("c", 5)])).toBe("c");
    expect(electHost([nobody, mobile("m", 5)])).toBe("m");
  });

  it("treats a player with no device as mobile rather than crashing", () => {
    const half = {
      clientId: "half",
      data: { name: "Half", colour: "#fff", role: "player" },
      timestamp: 1,
    } as unknown as PresenceMember;
    expect(electHost([half, desktop("d", 9)])).toBe("d");
  });
});
