// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  APICallError,
  JSONParseError,
  NoObjectGeneratedError,
  RetryError,
  TypeValidationError,
} from "ai";
import {
  parseAiSdkFailure,
  providerTelemetryToErrorClass,
  sanitizeReportFlowSentryExtra,
} from "./aiSdkFailureTelemetry";

describe("parseAiSdkFailure", () => {
  it("classificeert APICallError 429 als rate met upstream status", () => {
    const err = new APICallError({
      message: "rate limited secret body",
      url: "https://ai-gateway.vercel.sh/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: { "x-request-id": "req-429" },
      responseBody: '{"secret":"player"}',
      isRetryable: true,
    });
    const telemetry = parseAiSdkFailure(err);
    expect(telemetry.failureKind).toBe("rate");
    expect(telemetry.upstreamHttpStatus).toBe(429);
    expect(telemetry.isRetryable).toBe(true);
    expect(telemetry.providerRequestId).toBe("req-429");
    expect(providerTelemetryToErrorClass(telemetry)).toBe(
      "provider_rate_limited",
    );
  });

  it("classificeert NoObjectGeneratedError met finishReason en tokens", () => {
    const err = new NoObjectGeneratedError({
      message: "no object",
      text: "RAW MODEL OUTPUT WITH PLAYER NAMES",
      response: {
        id: "resp-abc",
        timestamp: new Date(),
        modelId: "openai/gpt-5.6-sol",
      },
      usage: { inputTokens: 1200, outputTokens: 400, totalTokens: 1600 },
      finishReason: "length",
    });
    const telemetry = parseAiSdkFailure(err);
    expect(telemetry.failureKind).toBe("no_object");
    expect(telemetry.finishReason).toBe("length");
    expect(telemetry.usagePromptTokens).toBe(1200);
    expect(telemetry.providerRequestId).toBe("resp-abc");
  });

  it("volgt RetryError naar geneste APICallError", () => {
    const inner = new APICallError({
      message: "upstream",
      url: "u",
      requestBodyValues: {},
      statusCode: 503,
      responseHeaders: {},
      responseBody: "",
      isRetryable: true,
    });
    const err = new RetryError({
      message: "retries",
      reason: "maxRetries",
      errors: [inner],
    });
    const telemetry = parseAiSdkFailure(err);
    expect(telemetry.upstreamHttpStatus).toBe(503);
    expect(telemetry.failureKind).toBe("transport");
    expect(telemetry.causeSdkErrorName).toBe("AI_RetryError");
  });

  it("classificeert schema- en parsefouten", () => {
    expect(
      parseAiSdkFailure(
        new TypeValidationError({ value: { player: "x" }, cause: undefined }),
      ).failureKind,
    ).toBe("schema");
    expect(
      parseAiSdkFailure(new JSONParseError({ text: "{not json}", cause: null }))
        .failureKind,
    ).toBe("parse");
  });

  it("sanitizeReportFlowSentryExtra dropt ruwe velden maar bewaart telemetrie", () => {
    const sanitized = sanitizeReportFlowSentryExtra({
      flowId: "11111111-1111-4111-8111-111111111111",
      info: "Bearer sk-secret",
      prompt: "leak",
      providerTelemetry: {
        sdkErrorName: "AI_APICallError",
        failureKind: "rate",
        upstreamHttpStatus: 429,
      },
    });
    expect(sanitized).not.toHaveProperty("info");
    expect(sanitized).not.toHaveProperty("prompt");
    expect(sanitized.providerTelemetry).toEqual({
      sdkErrorName: "AI_APICallError",
      failureKind: "rate",
      upstreamHttpStatus: 429,
    });
  });
});
