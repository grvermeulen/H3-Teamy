import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { NextRequest } from "next/server";
import { getActiveUser } from "./activeUser";
import { prisma } from "./db";
import * as nextAuth from "next-auth";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("./db", () => ({
  prisma: {
    identity: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    rsvp: {
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe("getActiveUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nextAuth.getServerSession).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries when Prisma reports connection terminated then succeeds", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.mocked(prisma.user.create).mockImplementation(() => {
      calls += 1;
      if (calls < 2) {
        return Promise.reject(new Error("Connection terminated unexpectedly"));
      }
      return Promise.resolve({
        id: "u1",
        firstName: "",
        lastName: "",
      });
    });

    const req = new NextRequest("https://example.com/", {
      headers: { cookie: "" },
    });

    const promise = getActiveUser(req);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual({ userId: "u1", needsLink: false });
    expect(vi.mocked(prisma.user.create)).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-transient errors from Prisma", async () => {
    vi.mocked(prisma.user.create).mockRejectedValue(new Error("unique"));

    const req = new NextRequest("https://example.com/");
    await expect(getActiveUser(req)).rejects.toThrow("unique");
  });

  it("treats anon_id equal to an existing user id as legacy cookie and skips cookie identity lookup", async () => {
    const legacyUserId = "clxxxxxxxxxxxxxxxxxxxxxxxxx";
    vi.mocked(prisma.user.findUnique).mockImplementation(({ where }) => {
      if ("id" in where && where.id === legacyUserId) {
        return Promise.resolve({ id: legacyUserId });
      }
      return Promise.resolve(null);
    });

    const req = new NextRequest("https://example.com/", {
      headers: { cookie: `anon_id=${legacyUserId}` },
    });

    const result = await getActiveUser(req);
    expect(result).toEqual({ userId: legacyUserId, needsLink: false });
    expect(vi.mocked(prisma.identity.findUnique)).not.toHaveBeenCalled();
  });

  it("uses cookie UUID for anonymous identity when anon_id is a random UUID", async () => {
    const cookieUuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.identity.findUnique).mockResolvedValue({
      id: "i1",
      createdAt: new Date(),
      userId: "u-cookie",
      provider: "cookie",
      providerUserId: cookieUuid,
    });

    const req = new NextRequest("https://example.com/", {
      headers: { cookie: `anon_id=${cookieUuid}` },
    });

    const result = await getActiveUser(req);
    expect(result).toEqual({ userId: "u-cookie", needsLink: false });
    expect(vi.mocked(prisma.identity.findUnique)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_providerUserId: {
            provider: "cookie",
            providerUserId: cookieUuid,
          },
        },
      }),
    );
  });
});
