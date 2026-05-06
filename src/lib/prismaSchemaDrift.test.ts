import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { DbUnavailableError } from "./dbUnavailableError";
import {
  isPrismaSchemaDriftError,
  withPrismaSchemaDriftAsDbUnavailable,
} from "./prismaSchemaDrift";

describe("isPrismaSchemaDriftError", () => {
  it("returns true for P2021 (table missing)", () => {
    const err = new Prisma.PrismaClientKnownRequestError("no table", {
      code: "P2021",
      clientVersion: "7",
    });
    expect(isPrismaSchemaDriftError(err)).toBe(true);
  });

  it("returns true for P2022 (column missing)", () => {
    const err = new Prisma.PrismaClientKnownRequestError("no column", {
      code: "P2022",
      clientVersion: "7",
    });
    expect(isPrismaSchemaDriftError(err)).toBe(true);
  });

  it("returns false for other Prisma codes", () => {
    const err = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "7",
    });
    expect(isPrismaSchemaDriftError(err)).toBe(false);
  });
});

describe("withPrismaSchemaDriftAsDbUnavailable", () => {
  it("returns fn result on success", async () => {
    const v = await withPrismaSchemaDriftAsDbUnavailable(async () => 42);
    expect(v).toBe(42);
  });

  it("maps P2021 to DbUnavailableError", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("no table", {
      code: "P2021",
      clientVersion: "7",
    });
    await expect(
      withPrismaSchemaDriftAsDbUnavailable(async () => {
        throw err;
      }),
    ).rejects.toThrow(DbUnavailableError);
  });

  it("rethrows other errors", async () => {
    const err = new Error("boom");
    await expect(
      withPrismaSchemaDriftAsDbUnavailable(async () => {
        throw err;
      }),
    ).rejects.toThrow("boom");
  });
});
