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
});
