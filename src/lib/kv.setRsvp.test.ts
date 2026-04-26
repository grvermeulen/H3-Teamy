import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const mockEventUpsert = vi.fn();
const mockUserUpsert = vi.fn();
const mockRsvpUpsert = vi.fn();
const mockRsvpDelete = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  vi.doMock("./db", () => ({
    prisma: {
      event: { upsert: mockEventUpsert },
      user: { upsert: mockUserUpsert },
      rsvp: { upsert: mockRsvpUpsert, delete: mockRsvpDelete },
    },
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("setRsvp (Prisma path)", () => {
  it("upserts Event and User before RSVP so FK constraints hold", async () => {
    mockEventUpsert.mockResolvedValue(undefined);
    mockUserUpsert.mockResolvedValue(undefined);
    mockRsvpUpsert.mockResolvedValue(undefined);

    const { setRsvp } = await import("./kv");
    await setRsvp("user-1", "evt-2026-04-25T12:00:00Z--training", "yes");

    expect(mockEventUpsert).toHaveBeenCalledTimes(1);
    expect(mockEventUpsert).toHaveBeenCalledWith({
      where: { id: "evt-2026-04-25T12:00:00Z--training" },
      create: { id: "evt-2026-04-25T12:00:00Z--training" },
      update: {},
    });
    expect(mockUserUpsert).toHaveBeenCalledTimes(1);
    expect(mockRsvpUpsert).toHaveBeenCalledTimes(1);
  });

  it("reports RSVP delete failures to Sentry", async () => {
    const err = new Error("not found");
    mockRsvpDelete.mockRejectedValue(err);

    const { setRsvp } = await import("./kv");
    await setRsvp("user-1", "evt-1", null);

    expect(mockRsvpDelete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(err, {
      extra: { userId: "user-1", eventId: "evt-1", context: "setRsvp_delete" },
    });
  });
});
