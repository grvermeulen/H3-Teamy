// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getReportExtractGatewayModel,
  resolveReportExtractGatewayModel,
} from "./ai/gatewayModels";

/**
 * Rode/groene regressie voor prod-incident Nov 2026: default `gpt-5.6-sol`
 * → 502 op gateway; `gpt-4o` → succes (live bevestigd op Vercel preview/prod).
 */
describe("report extract vision model regression", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("groen: lege env gebruikt gpt-4o (niet 5.6-sol)", () => {
    vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "");
    expect(getReportExtractGatewayModel()).toBe("openai/gpt-4o");
  });

  it("groen: expliciete 5.6-sol override wordt naar gpt-4o herschreven", () => {
    vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "gpt-5.6-sol");
    const resolved = resolveReportExtractGatewayModel("gpt-5.6-sol");
    expect(resolved.model).toBe("openai/gpt-4o");
    expect(resolved.substitutedFrom).toBe("gpt-5.6-sol");
  });
});
