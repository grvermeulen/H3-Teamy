import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeArenaRequest } from "./arenaAuth";

const { session, findUnique, checkLimit } = vi.hoisted(() => ({
  session: vi.fn(),
  findUnique: vi.fn(),
  checkLimit: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: session }));
vi.mock("./authOptions", () => ({ authOptions: {} }));
vi.mock("./db", () => ({ prisma: { user: { findUnique } } }));
vi.mock("./rateLimit", async (original) => ({
  ...(await original<typeof import("./rateLimit")>()),
  checkRateLimit: checkLimit,
}));

describe("arena authentication boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLimit.mockResolvedValue({ allowed: true });
    session.mockResolvedValue(null);
    findUnique.mockResolvedValue(null);
  });

  it.each(["victim-account-id", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"])(
    "refuses anonymous cookie %s before accessing the database",
    async (cookie) => {
      const result = await authorizeArenaRequest(
        new NextRequest("http://localhost/api/arena/realtime-token", {
          headers: { cookie: `anon_id=${cookie}` },
        }),
      );
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(401);
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it("limits requests before session or database work", async () => {
    checkLimit.mockResolvedValueOnce({ allowed: false, retryAfterSec: 25 });
    const result = await authorizeArenaRequest(
      new NextRequest("http://localhost/api/arena/realtime-token"),
    );
    expect((result as Response).status).toBe(429);
    expect(session).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("uses the authenticated account even when a victim cookie is supplied", async () => {
    session.mockResolvedValue({
      user: { id: "my-account", email: "me@example.test" },
    });
    findUnique.mockResolvedValue({ id: "my-account", firstName: "Guido" });
    const result = await authorizeArenaRequest(
      new NextRequest("http://localhost/api/arena/realtime-token", {
        headers: { cookie: "anon_id=victim-account" },
      }),
    );
    expect(result).toEqual({ userId: "my-account", displayName: "Guido" });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "my-account" },
      select: { id: true, firstName: true },
    });
  });

  it("resolves a Google subject through its signed session email", async () => {
    session.mockResolvedValue({
      user: { id: "google-subject", email: "ME@example.test" },
    });
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "my-account", firstName: "" });
    expect(
      await authorizeArenaRequest(
        new NextRequest("http://localhost/api/arena/realtime-token"),
      ),
    ).toEqual({ userId: "my-account", displayName: "Speler" });
  });

  it("refuses a deleted account without creating a replacement", async () => {
    session.mockResolvedValue({ user: { id: "deleted-account" } });
    const result = await authorizeArenaRequest(
      new NextRequest("http://localhost/api/arena/realtime-token"),
    );
    expect((result as Response).status).toBe(403);
  });

  it("refuses cross-origin mutations before authentication", async () => {
    const result = await authorizeArenaRequest(
      new NextRequest("http://localhost/api/arena/matches", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect((result as Response).status).toBe(403);
    expect(session).not.toHaveBeenCalled();
  });
});
