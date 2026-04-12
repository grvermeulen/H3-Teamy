import { describe, expect, it } from "vitest";

/** Normaliseert origin (zonder trailing slash) voor fetch-URL’s. */
const baseUrl =
  process.env.PRODUCTION_VERIFY_BASE_URL?.replace(/\/+$/, "") ?? "";

/**
 * Lichtgewicht HTTP-checks tegen een gedeployde URL (alleen GET). In CI: preview- of
 * productie-origin via `PRODUCTION_VERIFY_BASE_URL`. Zonder die var wordt de suite overgeslagen.
 */
describe.skipIf(!baseUrl)("Production HTTP smoke (read-only)", () => {
  it("GET / retourneert 200", async () => {
    const res = await fetch(`${baseUrl}/`, { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("GET /login retourneert 200", async () => {
    const res = await fetch(`${baseUrl}/login`, { method: "GET" });
    expect(res.status).toBe(200);
  });
});
