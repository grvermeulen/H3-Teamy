import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../db";
import { DbUnavailableError } from "../dbUnavailableError";
import {
  authorizeArenaToken,
  commandArenaRoom,
  listArenaRooms,
} from "./arenaRoomService";

vi.mock("../db", () => ({
  prisma: {
    $transaction: vi.fn(),
    arenaRoom: {
      findMany: vi.fn(),
    },
  },
}));

function arenaSchemaDriftError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "The table `public.ArenaRoomMember` does not exist in the current database.",
    { code: "P2021", clientVersion: "7.10.0" },
  );
}

describe("arenaRoomService schema drift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps missing arena tables to DbUnavailableError for session commands", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(arenaSchemaDriftError());

    await expect(
      commandArenaRoom(
        { userId: "user-1", displayName: "Guido" },
        { action: "create", zone: "campus", joinNonce: randomUUID() },
      ),
    ).rejects.toThrow(DbUnavailableError);
  });

  it("maps missing arena tables to DbUnavailableError for realtime tokens", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(arenaSchemaDriftError());

    await expect(
      authorizeArenaToken("user-1", "member-1"),
    ).rejects.toThrow(DbUnavailableError);
  });

  it("maps missing arena tables to DbUnavailableError for lobby listing", async () => {
    vi.mocked(prisma.arenaRoom.findMany).mockRejectedValue(
      arenaSchemaDriftError(),
    );

    await expect(listArenaRooms()).rejects.toThrow(DbUnavailableError);
  });
});
