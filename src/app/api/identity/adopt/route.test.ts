import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { POST } from "./route";
import { prisma } from "../../../../lib/db";
import { getActiveUser } from "../../../../lib/activeUser";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  prisma: {
    identity: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../../../lib/activeUser", () => ({
  getActiveUser: vi.fn(),
}));

describe("POST /api/identity/adopt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses deleteMany when removing an empty cookie user (no Sentry on race)", async () => {
    const cookieId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const authUserId = "auth-user";
    const cookieUserId = "cookie-user";

    vi.mocked(getActiveUser).mockResolvedValue({
      userId: authUserId,
      needsLink: false,
    });

    vi.mocked(prisma.identity.findUnique).mockResolvedValue({
      userId: cookieUserId,
      user: { id: cookieUserId },
    } as never);

    const txDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const txUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const txUpsert = vi.fn().mockResolvedValue({});
    const txCount = vi.fn().mockResolvedValue(0);

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        rsvp: { updateMany: txUpdateMany },
        identity: { upsert: txUpsert, count: txCount },
        user: { deleteMany: txDeleteMany },
      });
    });

    const req = new NextRequest("https://example.com/api/identity/adopt", {
      method: "POST",
      headers: { cookie: `anon_id=${cookieId}` },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(txDeleteMany).toHaveBeenCalledWith({ where: { id: cookieUserId } });
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });
});
