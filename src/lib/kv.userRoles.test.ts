import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

const mockUserRoleFindUnique = vi.fn();
const mockUserRoleFindMany = vi.fn();
const mockUserRoleUpsert = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  vi.stubEnv("KV_REST_API_URL", "https://kv.example.com");
  vi.stubEnv("KV_REST_API_TOKEN", "token");
  vi.doMock("./db", () => ({
    prisma: {
      userRole: {
        findUnique: mockUserRoleFindUnique,
        findMany: mockUserRoleFindMany,
        upsert: mockUserRoleUpsert,
      },
    },
  }));
  vi.doMock("ioredis", () => ({
    default: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockRejectedValue(new Error("Redis down")),
      disconnect: vi.fn(),
    })),
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mockKvRestStore() {
  const store = new Map<string, string>();
  vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/set/")) {
      const key = decodeURIComponent(url.split("/set/")[1]?.split("?")[0] ?? "");
      const body = typeof init?.body === "string" ? init.body : "";
      store.set(key, body);
      return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
    }
    if (url.includes("/get/")) {
      const key = decodeURIComponent(url.split("/get/")[1]?.split("?")[0] ?? "");
      const val = store.get(key) ?? null;
      return new Response(JSON.stringify({ result: val }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
  return store;
}

describe("user role storage", () => {
  it("stores and reads trainer role via KV REST when Redis is unavailable", async () => {
    mockKvRestStore();
    mockUserRoleUpsert.mockResolvedValue({});
    mockUserRoleFindUnique.mockResolvedValue(null);

    const { setUserRoles, getUserRoles } = await import("./kv");
    await setUserRoles("user_arjen", {
      admin: false,
      trainer: true,
      player: true,
    });

    expect(mockUserRoleUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_arjen" },
        create: expect.objectContaining({ trainer: true }),
      }),
    );

    const roles = await getUserRoles("user_arjen");
    expect(roles).toEqual({ admin: false, trainer: true, player: true });
  });

  it("falls back to Postgres when KV has no role entry", async () => {
    mockKvRestStore();
    mockUserRoleFindUnique.mockResolvedValue({
      userId: "user_arjen",
      admin: false,
      trainer: true,
      player: true,
    });

    const { getUserRoles } = await import("./kv");
    const roles = await getUserRoles("user_arjen");

    expect(roles).toEqual({ admin: false, trainer: true, player: true });
    expect(mockUserRoleFindUnique).toHaveBeenCalledWith({
      where: { userId: "user_arjen" },
    });
  });

  it("loads missing batch entries from Postgres", async () => {
    mockKvRestStore();
    mockUserRoleFindMany.mockResolvedValue([
      {
        userId: "user_arjen",
        admin: false,
        trainer: true,
        player: true,
      },
    ]);

    const { getUserRolesBatch } = await import("./kv");
    const roles = await getUserRolesBatch(["user_arjen", "user_other"]);

    expect(roles.user_arjen).toEqual({
      admin: false,
      trainer: true,
      player: true,
    });
    expect(roles.user_other).toEqual({ player: true });
  });

  it("falls back without Sentry when the UserRole table is missing", async () => {
    mockKvRestStore();
    mockUserRoleFindUnique.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        "The table `public.UserRole` does not exist in the current database.",
        { code: "P2021", clientVersion: "test" },
      ),
    );

    const { getUserRoles } = await import("./kv");
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(Sentry.addBreadcrumb).mockClear();

    const roles = await getUserRoles("user_arjen");

    expect(roles).toEqual({ player: true });
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tags: expect.objectContaining({ operation: "getUserRoles_db" }),
      }),
    );
    expect(vi.mocked(Sentry.addBreadcrumb)).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "postgres",
        level: "warning",
      }),
    );
  });
});
