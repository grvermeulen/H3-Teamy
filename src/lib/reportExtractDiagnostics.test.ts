import { describe, expect, it } from "vitest";
import {
  buildExtractDiagnosticResponse,
  classifyExtractProviderFailure,
  sanitizeExtractSentryExtra,
} from "./reportExtractDiagnostics";
import {
  reportExtractSupportRef,
  resolveReportExtractAttemptId,
} from "./reportExtractAttemptId";

describe("reportExtractDiagnostics", () => {
  it("classificeert providerfouten zonder ruwe tekst door te geven", () => {
    expect(
      classifyExtractProviderFailure("Unauthenticated request to AI Gateway"),
    ).toBe("gateway_unauthenticated");
    expect(classifyExtractProviderFailure("something timed out")).toBe(
      "provider_timeout",
    );
    expect(classifyExtractProviderFailure(undefined)).toBe(
      "provider_request_failed",
    );
  });

  it("bouwt supportRef uit attempt en request id", () => {
    const ref = reportExtractSupportRef(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(ref).toBe("11111111-22222222");
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
      }).errorClass,
    ).toBe("provider_timeout");
  });
});
