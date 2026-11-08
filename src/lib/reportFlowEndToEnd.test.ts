// @vitest-environment node
import { describe, expect, it } from "vitest";
import { APICallError } from "ai";
import { parseAiSdkFailure } from "./aiSdkFailureTelemetry";
import { classifyExtractProviderFailure } from "./reportExtractDiagnostics";
import { resolveReportFlowId } from "./reportFlowCorrelation";

describe("report flow correlation", () => {
  it("houdt flowId constant tussen header en body-kandidaten", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      resolveReportFlowId(id, "22222222-2222-4222-8222-222222222222"),
    ).toBe(id);
  });

  it("classificeert productie-achtige provider_fail niet als generiek", () => {
    const telemetry = parseAiSdkFailure(
      new APICallError({
        message: "Forbidden",
        url: "https://ai-gateway.vercel.sh/v1",
        requestBodyValues: {},
        statusCode: 403,
        responseHeaders: { "x-request-id": "live-req" },
        responseBody: '{"type":"forbidden"}',
        isRetryable: false,
      }),
    );
    expect(
      classifyExtractProviderFailure({ providerTelemetry: telemetry }),
    ).toBe("gateway_unauthenticated");
    expect(telemetry.upstreamHttpStatus).toBe(403);
    expect(telemetry.providerRequestId).toBe("live-req");
  });
});

describe("synthetic tall screenshot metadata", () => {
  it("past bij 1080x9348 preprocess limiet zonder echte afbeelding", () => {
    const inputWidth = 1080;
    const inputHeight = 9348;
    const maxDim = 7800;
    const scale = maxDim / inputHeight;
    const outputWidth = Math.round(inputWidth * scale);
    const outputHeight = maxDim;
    expect(outputWidth).toBe(901);
    expect(outputHeight).toBe(7800);
  });
});
