import type { ErrorEvent, EventHint } from "@sentry/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isBenignTurbopackRootPackageJsonParseNoise,
  shouldDropBenignTurbopackPackageJsonNoiseForSentry,
} from "./sentryBenignTurbopackPackageJsonNoise";

describe("isBenignTurbopackRootPackageJsonParseNoise", () => {
  it("herkent Turbopack-locatieregels voor root package.json", () => {
    expect(
      isBenignTurbopackRootPackageJsonParseNoise("Error: ./package.json:3:1"),
    ).toBe(true);
    expect(
      isBenignTurbopackRootPackageJsonParseNoise("⨯ ./package.json:3:3"),
    ).toBe(true);
  });

  it("herkent gecombineerde parse-fouttekst", () => {
    expect(
      isBenignTurbopackRootPackageJsonParseNoise(
        "Error parsing package.json file package.json is not parseable: invalid JSON",
      ),
    ).toBe(true);
  });

  it("laat andere fouten door", () => {
    expect(isBenignTurbopackRootPackageJsonParseNoise("TypeError: x")).toBe(
      false,
    );
  });
});

describe("shouldDropBenignTurbopackPackageJsonNoiseForSentry", () => {
  const baseEvent: ErrorEvent = {
    exception: { values: [{ value: "Error: ./package.json:3:1" }] },
  };
  const baseHint: EventHint = {
    originalException: new Error("Error: ./package.json:3:1"),
  };

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("dropt in development", () => {
    expect(
      shouldDropBenignTurbopackPackageJsonNoiseForSentry(baseEvent, baseHint),
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
      shouldDropBenignTurbopackPackageJsonNoiseForSentry(event, baseHint),
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
      shouldDropBenignTurbopackPackageJsonNoiseForSentry(event, baseHint),
    ).toBe(false);
  });
});
