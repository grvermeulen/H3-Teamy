import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mintCookieAnonIdForUser } from "./activeUserCookies";
import { prisma } from "./db";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock("./db", () => ({
  prisma: {
    identity: {
      upsert: vi.fn(),
    },
  },
}));

describe("mintCookieAnonIdForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.identity.upsert).mockResolvedValue({
      id: "id1",
      createdAt: new Date(),
      userId: "u1",
      provider: "cookie",
      providerUserId: "00000000-0000-4000-8000-000000000001",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("upserts a cookie identity and returns a UUID string", async () => {
    const anon = await mintCookieAnonIdForUser("user-abc");
    expect(anon).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(vi.mocked(prisma.identity.upsert)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.identity.upsert).mock.calls[0][0];
    expect(call.create).toMatchObject({
      provider: "cookie",
      providerUserId: anon,
      userId: "user-abc",
    });
    expect(call.update).toEqual({ userId: "user-abc" });
  });
});
