import { describe, expect, it } from "vitest";
import {
  DbUnavailableError,
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "./dbUnavailableError";

describe("DbUnavailableError", () => {
  it("is recognized by isDbUnavailableError", () => {
    const err = new DbUnavailableError();
    expect(isDbUnavailableError(err)).toBe(true);
    expect(isDbUnavailableError(new Error("x"))).toBe(false);
  });

  it("jsonDatabaseUnavailable returns 503 with Dutch body", async () => {
    const res = jsonDatabaseUnavailable();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Database");
  });
});
