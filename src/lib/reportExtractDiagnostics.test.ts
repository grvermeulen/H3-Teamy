import { describe, expect, it, vi } from "vitest";
import {
  buildExtractDiagnosticResponse,
  classifyExtractProviderFailure,
  logReportExtractTrace,
  sanitizeExtractSentryExtra,
} from "./reportExtractDiagnostics";
import {
  reportExtractSupportRef,
  resolveReportExtractAttemptId,
} from "./reportExtractAttemptId";

describe("reportExtractDiagnostics", () => {
  it("classificeert providerfouten via SDK-telemetrie en legacy regex", () => {
    expect(
      classifyExtractProviderFailure({
        providerTelemetry: {
          sdkErrorName: "AI_APICallError",
          failureKind: "rate",
          upstreamHttpStatus: 429,
        },
      }),
    ).toBe("provider_rate_limited");
    expect(
      classifyExtractProviderFailure({
        info: "Unauthenticated request to AI Gateway",
      }),
    ).toBe("gateway_unauthenticated");
    expect(
      classifyExtractProviderFailure({ info: "something timed out" }),
    ).toBe("provider_timeout");
    expect(classifyExtractProviderFailure({})).toBe("provider_request_failed");
    expect(
      classifyExtractProviderFailure({
        info: "Image dimensions exceed 8000px limit",
        providerTelemetry: {
          sdkErrorName: "APICallError",
          failureKind: "transport",
          upstreamHttpStatus: 502,
        },
      }),
    ).toBe("image_dimension_rejected");
  });

  it("bouwt supportRef uit attempt en request id", () => {
    const ref = reportExtractSupportRef(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(ref).toBe("11111111-22222222");
  });

  it("prefereert header, valt terug op form-field", () => {
    expect(
      resolveReportExtractAttemptId(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ),
    ).toBe("11111111-1111-4111-8111-111111111111");
    expect(
      resolveReportExtractAttemptId(
        null,
        "22222222-2222-4222-8222-222222222222",
      ),
    ).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("valideert client attempt-id header", () => {
    expect(
      resolveReportExtractAttemptId("11111111-1111-4111-8111-111111111111"),
    ).toBe("11111111-1111-4111-8111-111111111111");
    expect(resolveReportExtractAttemptId("not-a-uuid")).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
  });

  it("sanitizeExtractSentryExtra verwijdert info/raw payloads", () => {
    expect(
      sanitizeExtractSentryExtra({ attemptId: "a", info: "secret body" }),
    ).toEqual({ attemptId: "a" });
  });

  it("diagnostic response bevat errorClass indien gezet", () => {
    expect(
      buildExtractDiagnosticResponse({
        attemptId: "a",
        requestId: "b",
        errorClass: "provider_timeout",
      }),
    ).toMatchObject({
      errorClass: "provider_timeout",
      flowId: "a",
    });
  });

  it("logReportExtractTrace spiegelt naar report_flow_trace", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    logReportExtractTrace({
      event: "report_extract_trace",
      attemptId: "11111111-1111-4111-8111-111111111111",
      requestId: "22222222-2222-4222-8222-222222222222",
      phase: "entry",
    });
    const mirrored = infoSpy.mock.calls.find(
      (c) => c[0] === "report_flow_trace",
    )?.[1] as { scope?: string; flowId?: string } | undefined;
    expect(mirrored?.scope).toBe("extract");
    expect(mirrored?.flowId).toBe("11111111-1111-4111-8111-111111111111");
    infoSpy.mockRestore();
  });
});
