import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const mockUserFindFirst = vi.fn();
const mockUserUpdate = vi.fn();
const mockLinkCodeFindFirst = vi.fn();
const mockLinkCodeFindUnique = vi.fn();
const mockLinkCodeDelete = vi.fn();
const mockLinkCodeDeleteMany = vi.fn();
const mockLinkCodeCreate = vi.fn();
const mockTransaction = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  vi.stubEnv("KV_REST_API_URL", "https://kv.example.com");
  vi.stubEnv("KV_REST_API_TOKEN", "token");
  mockTransaction.mockImplementation(async (ops: unknown[]) => {
    for (const op of ops) {
      await op;
    }
  });
  mockLinkCodeFindFirst.mockResolvedValue(null);
  mockLinkCodeDelete.mockResolvedValue({});
  mockLinkCodeDeleteMany.mockResolvedValue({ count: 0 });
  vi.doMock("./db", () => ({
    prisma: {
      user: {
        findFirst: mockUserFindFirst,
        update: mockUserUpdate,
      },
      linkCode: {
        findFirst: mockLinkCodeFindFirst,
        findUnique: mockLinkCodeFindUnique,
        delete: mockLinkCodeDelete,
        deleteMany: mockLinkCodeDeleteMany,
        create: mockLinkCodeCreate,
      },
      $transaction: mockTransaction,
    },
  }));
  vi.doMock("ioredis", () => ({
    default: class MockIORedis {
      connect = vi.fn().mockRejectedValue(new Error("Redis down"));
      disconnect = vi.fn();
    },
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("password reset token storage", () => {
  it("stores and redeems via KV REST when Redis is unavailable", async () => {
    mockUserFindFirst.mockResolvedValue({
      id: "user_test",
      email: "grvermeulen@gmail.com",
    });
    mockUserUpdate.mockResolvedValue({});

    const store = new Map<string, string>();
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/set/")) {
        const match = url.match(/\/set\/([^/]+)\/([^?]+)/);
        if (match) {
          store.set(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
        }
        return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
      }
      if (url.includes("/get/")) {
        const match = url.match(/\/get\/([^/]+)/);
        const key = match ? decodeURIComponent(match[1]) : "";
        const val = store.get(key) ?? null;
        return new Response(JSON.stringify({ result: val }), { status: 200 });
      }
      if (url.includes("/del/")) {
        const match = url.match(/\/del\/([^/]+)/);
        const key = match ? decodeURIComponent(match[1]) : "";
        store.delete(key);
        return new Response(JSON.stringify({ result: 1 }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const { createPasswordResetToken, redeemPasswordResetToken } = await import(
      "./kv"
    );
    const created = await createPasswordResetToken("grvermeulen@gmail.com");
    expect(created.token).toBeTruthy();

    const redeemed = await redeemPasswordResetToken(
      created.token!,
      "newpassword123",
    );
    expect(redeemed.ok).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
    expect(
      [...store.keys()].some((key) => key.startsWith("pwreset:")),
    ).toBe(false);
  });

  it("stores and redeems via Postgres when KV and Redis are unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockUserFindFirst.mockResolvedValue({
      id: "user_test",
      email: "[REDACTED]",
    });
    mockUserUpdate.mockResolvedValue({});
    mockLinkCodeFindFirst.mockResolvedValue(null);
    mockLinkCodeDeleteMany.mockResolvedValue({ count: 0 });
    mockLinkCodeCreate.mockResolvedValue({});
    mockLinkCodeFindUnique.mockImplementation(
      async ({ where }: { where: { code: string } }) => ({
        userId: "user_test",
        createdAt: new Date(),
        code: where.code,
      }),
    );
    mockLinkCodeDelete.mockResolvedValue({});
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const { createPasswordResetToken, redeemPasswordResetToken } = await import(
      "./kv"
    );
    const created = await createPasswordResetToken("[REDACTED]");
    expect(created.token).toBeTruthy();
    expect(mockLinkCodeCreate).toHaveBeenCalledWith({
      data: { code: created.token, userId: "user_test" },
    });

    const redeemed = await redeemPasswordResetToken(
      created.token!,
      "newpassword123",
    );
    expect(redeemed.ok).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalled();
    expect(mockLinkCodeDelete).toHaveBeenCalled();
  });
});
