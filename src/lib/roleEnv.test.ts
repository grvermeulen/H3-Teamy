import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBootstrapAdminUserIds,
  getBootstrapTrainerUserIds,
  mergeUserRoles,
  parseEnvUserIds,
} from "./roleEnv";

describe("parseEnvUserIds", () => {
  it("parses comma-separated ids and trims whitespace", () => {
    expect(
      Array.from(parseEnvUserIds(" user-a , user-b,user-c ")),
    ).toEqual(["user-a", "user-b", "user-c"]);
  });

  it("returns empty set for blank input", () => {
    expect(parseEnvUserIds("").size).toBe(0);
    expect(parseEnvUserIds(undefined).size).toBe(0);
  });
});

describe("bootstrap env role ids", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads ADMIN_USER_IDS", () => {
    vi.stubEnv("ADMIN_USER_IDS", "admin-1, admin-2");
    expect(Array.from(getBootstrapAdminUserIds())).toEqual(["admin-1", "admin-2"]);
  });

  it("reads TRAINER_USER_IDS", () => {
    vi.stubEnv("TRAINER_USER_IDS", "trainer-1");
    expect(Array.from(getBootstrapTrainerUserIds())).toEqual(["trainer-1"]);
  });
});

describe("mergeUserRoles", () => {
  const envAdmins = new Set(["admin-env"]);
  const envTrainers = new Set(["trainer-env"]);

  it("defaults to player when kv is empty", () => {
    expect(mergeUserRoles("other", {}, envAdmins, envTrainers)).toEqual({
      admin: false,
      trainer: false,
      player: true,
    });
  });

  it("applies bootstrap admin and trainer env ids", () => {
    expect(
      mergeUserRoles("admin-env", {}, envAdmins, envTrainers),
    ).toEqual({ admin: true, trainer: true, player: true });
    expect(
      mergeUserRoles("trainer-env", {}, envAdmins, envTrainers),
    ).toEqual({ admin: false, trainer: true, player: true });
  });

  it("merges kv flags with env ids", () => {
    expect(
      mergeUserRoles(
        "kv-trainer",
        { trainer: true },
        envAdmins,
        envTrainers,
      ),
    ).toEqual({ admin: false, trainer: true, player: true });
  });
});
