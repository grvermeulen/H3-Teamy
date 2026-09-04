import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { applyNextAuthUrlEnv, resolveNextAuthUrl } from "./nextAuthUrl";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("resolveNextAuthUrl", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses VERCEL_URL for preview when set", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "my-app-git-branch-team.vercel.app");
    vi.stubEnv("NEXTAUTH_URL", "https://production.example.com");
    expect(resolveNextAuthUrl()).toBe(
      "https://my-app-git-branch-team.vercel.app",
    );
  });

  it("uses explicit NEXTAUTH_URL when not on Vercel preview", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com/");
    expect(resolveNextAuthUrl()).toBe("https://app.example.com");
  });

  it("falls back to VERCEL_URL on Vercel production when NEXTAUTH_URL is unset", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_URL", "my-app.vercel.app");
    vi.stubEnv("NEXTAUTH_URL", "");
    expect(resolveNextAuthUrl()).toBe("https://my-app.vercel.app");
  });

  it("returns undefined when nothing is configured", () => {
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("VERCEL_URL", undefined);
    vi.stubEnv("NEXTAUTH_URL", undefined);
    expect(resolveNextAuthUrl()).toBeUndefined();
  });

  it("returns undefined for invalid NEXTAUTH_URL and logs parse errors to Sentry", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("NEXTAUTH_URL", ":");
    expect(resolveNextAuthUrl()).toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(TypeError),
      expect.objectContaining({
        extra: expect.objectContaining({ context: "nextauth_url_toOrigin" }),
      }),
    );
  });
});

describe("applyNextAuthUrlEnv", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    delete process.env.NEXTAUTH_URL;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.NEXTAUTH_URL;
  });

  it("sets NEXTAUTH_URL when resolveNextAuthUrl returns a value", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com/");
    applyNextAuthUrlEnv();
    expect(process.env.NEXTAUTH_URL).toBe("https://app.example.com");
  });

  it("removes invalid NEXTAUTH_URL so NextAuth can infer from request", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", ":");
    applyNextAuthUrlEnv();
    expect(process.env.NEXTAUTH_URL).toBeUndefined();
  });

  it("removes empty NEXTAUTH_URL", () => {
    vi.stubEnv("NEXTAUTH_URL", "   ");
    applyNextAuthUrlEnv();
    expect(process.env.NEXTAUTH_URL).toBeUndefined();
  });

  it("does nothing when NEXTAUTH_URL is unset", () => {
    applyNextAuthUrlEnv();
    expect(process.env.NEXTAUTH_URL).toBeUndefined();
  });
});
