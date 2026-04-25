import { describe, it, expect } from "vitest";
import { USER_CORE_SELECT } from "./userPrismaSelect";

describe("USER_CORE_SELECT", () => {
  it("beperkt User-reads tot kolommen die op alle omgevingen bestaan", () => {
    expect(USER_CORE_SELECT).toEqual({
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      passwordHash: true,
    });
  });
});
