import { afterEach, describe, expect, it, vi } from "vitest";
import { getOutboundEmailConfig, isOutboundEmailEnabled } from "./emailEnv";

describe("isOutboundEmailEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false when ENABLE_EMAIL=false", () => {
    vi.stubEnv("ENABLE_EMAIL", "false");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "noreply@example.com");
    vi.stubEnv("APP_URL", "https://teamy.example");
    expect(isOutboundEmailEnabled()).toBe(false);
  });

  it("is true when ENABLE_EMAIL=true and Resend is configured", () => {
    vi.stubEnv("ENABLE_EMAIL", "true");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "noreply@example.com");
    vi.stubEnv("APP_URL", "https://teamy.example");
    expect(isOutboundEmailEnabled()).toBe(true);
  });

  it("auto-enables when unset and Resend is fully configured", () => {
    vi.stubEnv("ENABLE_EMAIL", "");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "noreply@example.com");
    vi.stubEnv("APP_URL", "https://teamy.example");
    expect(isOutboundEmailEnabled()).toBe(true);
  });

  it("is false when unset and Resend is incomplete", () => {
    vi.stubEnv("ENABLE_EMAIL", "");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("APP_URL", "https://teamy.example");
    expect(isOutboundEmailEnabled()).toBe(false);
  });
});

describe("getOutboundEmailConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns trimmed config when enabled", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "noreply@example.com");
    vi.stubEnv("APP_URL", "https://teamy.example/");
    expect(getOutboundEmailConfig()).toEqual({
      resendApiKey: "re_test",
      fromEmail: "noreply@example.com",
      appUrl: "https://teamy.example",
    });
  });
});
