import type { ErrorEvent, EventHint } from "@sentry/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isBenignTurbopackDevCompileNoise,
  shouldDropBenignTurbopackDevCompileNoiseForSentry,
} from "./sentryBenignTurbopackDevCompileNoise";

describe("isBenignTurbopackDevCompileNoise", () => {
  it("herkent Turbopack-locatieregels voor root package.json", () => {
    expect(isBenignTurbopackDevCompileNoise("Error: ./package.json:3:1")).toBe(
      true,
    );
    expect(isBenignTurbopackDevCompileNoise("⨯ ./package.json:3:3")).toBe(true);
  });

  it("herkent Turbopack-locatieregels voor src-bestanden (dbMetrics)", () => {
    expect(
      isBenignTurbopackDevCompileNoise("Error: ./src/lib/dbMetrics.ts:1:1"),
    ).toBe(true);
    expect(
      isBenignTurbopackDevCompileNoise("⨯ ./src/lib/dbMetrics.ts:1:1"),
    ).toBe(true);
  });

  it("herkent gecombineerde package.json parse-fouttekst", () => {
    expect(
      isBenignTurbopackDevCompileNoise(
        "Error parsing package.json file package.json is not parseable: invalid JSON",
      ),
    ).toBe(true);
  });

  it("laat andere fouten door", () => {
    expect(isBenignTurbopackDevCompileNoise("TypeError: x")).toBe(false);
  });
});

describe("shouldDropBenignTurbopackDevCompileNoiseForSentry", () => {
  const baseEvent: ErrorEvent = {
    exception: {
      values: [{ value: "Error: ./src/lib/dbMetrics.ts:1:1" }],
    },
  };
  const baseHint: EventHint = {
    originalException: new Error("Error: ./src/lib/dbMetrics.ts:1:1"),
  };

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("dropt in development", () => {
    expect(
      shouldDropBenignTurbopackDevCompileNoiseForSentry(baseEvent, baseHint),
    ).toBe(true);
  });

  it("dropt in production wanneer request localhost is", () => {
    vi.stubEnv("NODE_ENV", "production");
    const event: ErrorEvent = {
      ...baseEvent,
      request: { url: "http://localhost:3000/" },
      environment: "production",
    };
    expect(
      shouldDropBenignTurbopackDevCompileNoiseForSentry(event, baseHint),
    ).toBe(true);
  });

  it("dropt niet in production zonder localhost/dev-tag", () => {
    vi.stubEnv("NODE_ENV", "production");
    const event: ErrorEvent = {
      ...baseEvent,
      request: { url: "https://h3-teamy.vercel.app/" },
      environment: "production",
    };
    expect(
      shouldDropBenignTurbopackDevCompileNoiseForSentry(event, baseHint),
    ).toBe(false);
  });
});
