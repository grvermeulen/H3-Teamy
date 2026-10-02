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
}));

vi.mock("@/lib/reportExtractProvider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/reportExtractProvider")>();
  return {
    ...actual,
    extractReportFromImage: vi.fn(),
  };
});

describe("POST /api/report/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    await expect(response.json()).resolves.toEqual({
      error: "invalid_content_type",
      message: "Verwacht multipart/form-data met een afbeelding.",
    });
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    expect(vi.mocked(extractReportFromImage)).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed multipart bodies without reporting to Sentry", async () => {
    const response = await POST(
      makeRequest({
        headers: { "content-type": "multipart/form-data; boundary=bad" },
        body: "not-multipart",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_form_data",
      message: "Kon het uploadformulier niet verwerken.",
    });
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
    await expect(response.json()).resolves.toEqual({
      error: "image_required",
    });
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
      providerUsed: "openai",
      model: "gpt-4o",
      fallbackUsed: false,
      latencyMs: 12,
    });

    const response = await POST(makeRequest({ body: form }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { homeScore: 2, awayScore: 1 },
      raw_text: "2-1",
      meta: { providerUsed: "openai", model: "gpt-4o", fallbackUsed: false },
    });
    expect(vi.mocked(extractReportFromImage)).toHaveBeenCalledTimes(1);
  });

  it("returns provider errors and reports them to Sentry", async () => {
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
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(ExtractProviderError),
      expect.objectContaining({
        tags: expect.objectContaining({ module: "report_extract" }),
      }),
    );
  });
});
