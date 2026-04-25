import { describe, it, expect } from "vitest";
import { userAuthSnapshotSelect } from "./userAuthSnapshot";

describe("userAuthSnapshotSelect", () => {
  it("bevat alleen id en naamvelden voor auth-snapshot queries", () => {
    expect(userAuthSnapshotSelect).toEqual({
      id: true,
      firstName: true,
      lastName: true,
    });
  });
});
