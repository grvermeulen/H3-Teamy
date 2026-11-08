// @vitest-environment node
// These tests build Request bodies with FormData/File; Node's Request rejects jsdom's File.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { POST } from "./route";
import {
  ExtractProviderError,
  extractReportFromImage,
} from "@/lib/reportExtractProvider";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock("@/lib/reportExtractProvider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/reportExtractProvider")>();
  return {
    ...actual,
    extractReportFromImage: vi.fn(),
  };
});

vi.mock("@/lib/reportExtractImageProbe", () => ({
  probeExtractImageUpload: vi.fn(),
}));

import { probeExtractImageUpload } from "@/lib/reportExtractImageProbe";

describe("POST /api/report/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(probeExtractImageUpload).mockResolvedValue({
      ok: true,
      mimeType: "image/jpeg",
      bytes: 6,
      width: 100,
      height: 200,
      visionResizePlanned: false,
      outputMimeType: "image/jpeg",
      outputWidth: 100,
      outputHeight: 200,
    });
  });

  function makeRequest(
    init: ConstructorParameters<typeof Request>[1] = {},
  ): NextRequest {
    return new NextRequest(
      new Request("http://localhost/api/report/extract", {
        method: "POST",
        ...init,
      }),
    );
  }

  it("returns 400 for non-multipart requests without reporting to Sentry", async () => {
    const response = await POST(
      makeRequest({
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "invalid_content_type",
      message: "Verwacht multipart/form-data met een afbeelding.",
      diagnostic: expect.objectContaining({
        supportRef: expect.any(String),
        attemptId: expect.any(String),
        requestId: expect.any(String),
        errorClass: "multipart_rejected",
      }),
    });
    expect(response.headers.get("X-Report-Extract-Request-Id")).toBeTruthy();
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    expect(vi.mocked(extractReportFromImage)).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed multipart bodies without reporting to Sentry", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await POST(
      makeRequest({
        headers: {
          "content-type": "multipart/form-data; boundary=bad",
          "content-length": "12",
        },
        body: "not-multipart",
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_form_data");
    expect(body.diagnostic?.errorClass).toBe("multipart_rejected");
    const failPayload = infoSpy.mock.calls
      .map((c) => c[1])
      .find(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          (p as { phase?: string }).phase === "multipart_fail",
      ) as
      | {
          uploadIngress?: {
            contentTypeHasBoundary?: boolean;
            contentLength?: { present: boolean; value?: number };
          };
        }
      | undefined;
    expect(failPayload?.uploadIngress?.contentTypeHasBoundary).toBe(true);
    expect(failPayload?.uploadIngress?.contentLength).toEqual({
      present: true,
      value: 12,
    });
    infoSpy.mockRestore();
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    expect(vi.mocked(extractReportFromImage)).not.toHaveBeenCalled();
  });

  it("returns 400 when multipart body has no image field", async () => {
    const form = new FormData();
    form.set("other", "value");

    const response = await POST(
      makeRequest({
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("image_required");
    expect(body.diagnostic?.errorClass).toBe("image_missing");
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("extracts report data from a valid image upload", async () => {
    const form = new FormData();
    form.set(
      "image",
      new File(["pixels"], "match.jpg", { type: "image/jpeg" }),
    );
    vi.mocked(extractReportFromImage).mockResolvedValue({
      result: { homeScore: 2, awayScore: 1 },
      rawText: "2-1",
      providerUsed: "vlm",
      model: "gpt-4o",
      fallbackUsed: false,
      latencyMs: 12,
    });

    const response = await POST(
      makeRequest({
        body: form,
        headers: {
          "X-Report-Extract-Attempt": "11111111-1111-4111-8111-111111111111",
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toEqual({ homeScore: 2, awayScore: 1 });
    expect(body.meta).toEqual({
      providerUsed: "vlm",
      model: "gpt-4o",
      fallbackUsed: false,
    });
    expect(body.diagnostic?.attemptId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(response.headers.get("X-Report-Extract-Request-Id")).toBeTruthy();
    expect(vi.mocked(extractReportFromImage)).toHaveBeenCalledTimes(1);
  });

  it("logt upstreamHttpStatus in provider_fail trace", async () => {
    const { APICallError } = await import("ai");
    const { parseAiSdkFailure } = await import("@/lib/aiSdkFailureTelemetry");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const form = new FormData();
    form.set(
      "image",
      new File(["pixels"], "match.jpg", { type: "image/jpeg" }),
    );
    vi.mocked(extractReportFromImage).mockRejectedValue(
      new ExtractProviderError({
        message: "provider failed",
        code: "openai_failed",
        status: 502,
        providerUsed: "vlm",
        model: "openai/gpt-5.6-sol",
        providerTelemetry: parseAiSdkFailure(
          new APICallError({
            message: "upstream",
            url: "u",
            requestBodyValues: {},
            statusCode: 403,
            responseHeaders: { "x-request-id": "p-req" },
            responseBody: "SECRET",
            isRetryable: false,
          }),
        ),
      }),
    );

    const response = await POST(makeRequest({ body: form }));
    expect(response.status).toBe(502);
    const fail = infoSpy.mock.calls
      .map((c) => c[1])
      .find(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          (p as { phase?: string }).phase === "provider_fail",
      ) as
      | {
          providerTelemetry?: { upstreamHttpStatus?: number };
          upstreamHttpStatus?: number;
          errorClass?: string;
        }
      | undefined;
    expect(fail?.providerTelemetry?.upstreamHttpStatus).toBe(403);
    expect(fail?.errorClass).toBe("gateway_unauthenticated");
    infoSpy.mockRestore();
  });

  it("returns provider errors with trace breadcrumb instead of Sentry exception", async () => {
    const form = new FormData();
    form.set(
      "image",
      new File(["pixels"], "match.jpg", { type: "image/jpeg" }),
    );
    vi.mocked(extractReportFromImage).mockRejectedValue(
      new ExtractProviderError({
        message: "provider failed",
        code: "provider_failed",
        status: 502,
        providerUsed: "openai",
        model: "gpt-4o",
      }),
    );

    const response = await POST(makeRequest({ body: form }));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe("provider_failed");
    expect(body.diagnostic?.errorClass).toBe("provider_request_failed");
    expect(body).not.toHaveProperty("info");
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    expect(vi.mocked(Sentry.addBreadcrumb)).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "report_extract",
        level: "warning",
      }),
    );
  });

  it("logt entry en preprocess_fail bij onleesbare upload", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.mocked(probeExtractImageUpload).mockResolvedValue({
      ok: false,
      mimeType: "image/jpeg",
      bytes: 3,
      errorClass: "preprocess_unreadable",
    });
    const form = new FormData();
    form.set("image", new File(["bad"], "x.jpg", { type: "image/jpeg" }));

    const response = await POST(makeRequest({ body: form }));

    expect(response.status).toBe(422);
    const traceEvents = infoSpy.mock.calls
      .map((c) => c[0])
      .filter((e) => e === "report_extract_trace");
    expect(traceEvents.length).toBeGreaterThanOrEqual(2);
    const phases = infoSpy.mock.calls
      .map((c) =>
        typeof c[1] === "object" && c[1]
          ? (c[1] as { phase?: string }).phase
          : "",
      )
      .filter(Boolean);
    expect(phases).toContain("entry");
    expect(phases).toContain("preprocess_fail");
    infoSpy.mockRestore();
  });
});
