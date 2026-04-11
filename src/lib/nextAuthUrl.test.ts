import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveNextAuthUrl } from "./nextAuthUrl";

describe("resolveNextAuthUrl", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
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
});
