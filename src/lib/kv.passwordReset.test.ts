import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const mockUserFindFirst = vi.fn();
const mockUserUpdate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  vi.stubEnv("KV_REST_API_URL", "https://kv.example.com");
  vi.stubEnv("KV_REST_API_TOKEN", "token");
  vi.doMock("./db", () => ({
    prisma: {
      user: {
        findFirst: mockUserFindFirst,
        update: mockUserUpdate,
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
});
