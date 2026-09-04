import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gatewayModelId,
  getReportExtractGatewayModel,
  getReportGenerateGatewayModel,
  getStructuredGatewayModel,
  inferGatewayProvider,
  isGatewayFreeTierAccessError,
  normalizeGatewayModelId,
  resolveGatewayModel,
  toGatewayModelString,
} from "./gatewayModels";

describe("gatewayModelId", () => {
  it("strips provider prefix", () => {
    expect(gatewayModelId("anthropic/claude-opus-4")).toBe("claude-opus-4");
    expect(gatewayModelId("gpt-4o")).toBe("gpt-4o");
  });
});

describe("toGatewayModelString", () => {
  it("passes through provider/model", () => {
    expect(toGatewayModelString("openai/gpt-4o", "openai")).toBe(
      "openai/gpt-4o",
    );
  });

  it("prepends openai provider for gpt models", () => {
    expect(toGatewayModelString("gpt-4o", "openai")).toBe("openai/gpt-4o");
  });

  it("prepends anthropic provider for claude models", () => {
    expect(toGatewayModelString("claude-sonnet-4-6", "openai")).toBe(
      "anthropic/claude-sonnet-4.6",
    );
  });
});

describe("normalizeGatewayModelId", () => {
  it("maps hyphenated claude sonnet env ids to dotted gateway ids", () => {
    expect(normalizeGatewayModelId("claude-sonnet-4-6")).toBe(
      "claude-sonnet-4.6",
    );
  });
});

describe("inferGatewayProvider", () => {
  it("returns anthropic for claude models", () => {
    expect(inferGatewayProvider("claude-sonnet-4-6")).toBe("anthropic");
  });

  it("returns openai for gpt models", () => {
    expect(inferGatewayProvider("gpt-4o")).toBe("openai");
  });
});

describe("resolveGatewayModel", () => {
  it("remaps claude-opus-4 to gpt-4o for structured calls", () => {
    expect(
      resolveGatewayModel("anthropic/claude-opus-4", "structured"),
    ).toEqual({
      model: "openai/gpt-4o",
      substitutedFrom: "anthropic/claude-opus-4",
    });
  });

  it("remaps claude-sonnet-4 for structured calls", () => {
    expect(
      resolveGatewayModel("anthropic/claude-sonnet-4", "structured"),
    ).toEqual({
      model: "openai/gpt-4o",
      substitutedFrom: "anthropic/claude-sonnet-4",
    });
  });

  it("remaps gpt-5-chat-latest to gpt-4o for text calls", () => {
    expect(resolveGatewayModel("openai/gpt-5-chat-latest", "text")).toEqual({
      model: "openai/gpt-4o",
      substitutedFrom: "openai/gpt-5-chat-latest",
    });
  });

  it("remaps any gpt-5 prefix for text", () => {
    expect(resolveGatewayModel("gpt-5-nano", "text")).toEqual({
      model: "openai/gpt-4o",
      substitutedFrom: "gpt-5-nano",
    });
  });

  it("passes through supported models", () => {
    expect(resolveGatewayModel("openai/gpt-4o-mini", "text")).toEqual({
      model: "openai/gpt-4o-mini",
    });
  });

  it("routes claude sonnet env ids to anthropic with dotted gateway id", () => {
    expect(resolveGatewayModel("claude-sonnet-4-6", "text")).toEqual({
      model: "anthropic/claude-sonnet-4.6",
    });
  });

  it("defaults empty input to kind-specific fallback", () => {
    expect(resolveGatewayModel("", "structured")).toEqual({
      model: "openai/gpt-4o",
    });
    expect(resolveGatewayModel("", "text")).toEqual({
      model: "openai/gpt-4o",
    });
  });
});

describe("getStructuredGatewayModel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses default when env unset", () => {
    vi.stubEnv("AI_GATEWAY_STRUCTURED_MODEL", "");
    expect(getStructuredGatewayModel()).toBe("openai/gpt-4o");
  });

  it("remaps blocked env override", () => {
    vi.stubEnv("AI_GATEWAY_STRUCTURED_MODEL", "anthropic/claude-opus-4");
    expect(getStructuredGatewayModel()).toBe("openai/gpt-4o");
  });

  it("remaps claude-sonnet-4 env override", () => {
    vi.stubEnv("AI_GATEWAY_STRUCTURED_MODEL", "anthropic/claude-sonnet-4");
    expect(getStructuredGatewayModel()).toBe("openai/gpt-4o");
  });
});

describe("getReportGenerateGatewayModel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses gpt-4o default when env unset", () => {
    vi.stubEnv("REPORT_GENERATE_MODEL", "");
    expect(getReportGenerateGatewayModel()).toBe("openai/gpt-4o");
  });

  it("remaps gpt-5 env override", () => {
    vi.stubEnv("REPORT_GENERATE_MODEL", "openai/gpt-5-chat-latest");
    expect(getReportGenerateGatewayModel()).toBe("openai/gpt-4o");
  });
});

describe("getReportExtractGatewayModel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses gpt-5.6-sol default when env unset", () => {
    vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "");
    expect(getReportExtractGatewayModel()).toBe("openai/gpt-5.6-sol");
  });

  it("remaps the legacy GPT-5 chat alias", () => {
    vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "openai/gpt-5-chat-latest");
    expect(getReportExtractGatewayModel()).toBe("openai/gpt-5.6-sol");
  });

  it("remaps provider-mismatched Claude ids", () => {
    vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "openai/claude-sonnet-4-6");
    expect(getReportExtractGatewayModel()).toBe("openai/gpt-5.6-sol");
  });

  it("remaps a bare Claude env override to the OpenAI extraction default", () => {
    vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "claude-sonnet-4-6");
    expect(getReportExtractGatewayModel()).toBe("openai/gpt-5.6-sol");
  });
});

describe("isGatewayFreeTierAccessError", () => {
  it("detects gateway free-tier message", () => {
    expect(
      isGatewayFreeTierAccessError(
        new Error(
          "Free tier users do not have access to this model. Upgrade to paid credits",
        ),
      ),
    ).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isGatewayFreeTierAccessError(new Error("timeout"))).toBe(false);
  });
});
