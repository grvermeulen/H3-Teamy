import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWebAuthnExpectedOrigins } from "./webAuthnRequest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("resolveWebAuthnExpectedOrigins", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("includes NEXTAUTH_URL origin when configured", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://team.example.org");
    const req = new NextRequest("https://team.example.org/api/x", {
      headers: { origin: "https://team.example.org" },
    });
    expect(resolveWebAuthnExpectedOrigins(req)).toContain(
      "https://team.example.org",
    );
  });

  it("falls back to Origin header when NEXTAUTH_URL unset", () => {
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    const req = new NextRequest("http://localhost:3000/api/x", {
      headers: { origin: "http://localhost:3000" },
    });
    expect(resolveWebAuthnExpectedOrigins(req)).toEqual([
      "http://localhost:3000",
    ]);
  });
});
