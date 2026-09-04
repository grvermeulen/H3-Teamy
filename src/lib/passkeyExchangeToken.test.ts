import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPasskeyExchangeToken,
  verifyPasskeyExchangeToken,
} from "./passkeyExchangeToken";

describe("passkeyExchangeToken", () => {
  beforeEach(() => {
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret-key-for-hmac-only");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a valid user id", () => {
    const token = createPasskeyExchangeToken("user-abc");
    expect(verifyPasskeyExchangeToken(token)).toBe("user-abc");
  });

  it("returns null when secret is missing", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXTAUTH_SECRET", "");
    expect(createPasskeyExchangeToken("u")).toBe("");
    expect(verifyPasskeyExchangeToken("x.y")).toBeNull();
  });

  it("returns null on tampered payload", () => {
    const token = createPasskeyExchangeToken("user-abc");
    const tampered = token.replace(/^./, "Z");
    expect(verifyPasskeyExchangeToken(tampered)).toBeNull();
  });

  it("returns null on malformed token", () => {
    expect(verifyPasskeyExchangeToken("no-dot")).toBeNull();
    expect(verifyPasskeyExchangeToken("")).toBeNull();
  });
});
