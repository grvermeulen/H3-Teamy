import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { DbUnavailableError } from "./dbUnavailableError";
import { throwIfPasskeyTableMissing } from "./passkeyPrismaErrors";

describe("throwIfPasskeyTableMissing", () => {
  it("throws DbUnavailableError for P2021 when message names Passkey table", () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "The table `public.Passkey` does not exist in the current database.",
      { code: "P2021", clientVersion: "6" },
    );
    expect(() => throwIfPasskeyTableMissing(err)).toThrow(DbUnavailableError);
  });

  it("does nothing for P2021 on a different table", () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "The table `public.Other` does not exist in the current database.",
      { code: "P2021", clientVersion: "6" },
    );
    expect(() => throwIfPasskeyTableMissing(err)).not.toThrow();
  });

  it("does nothing for P2002 unique constraint", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique", {
      code: "P2002",
      clientVersion: "6",
    });
    expect(() => throwIfPasskeyTableMissing(err)).not.toThrow();
  });
});
