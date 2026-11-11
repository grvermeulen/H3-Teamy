// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import {
  getReportExtractGatewayModel,
  resolveReportExtractGatewayModel,
} from "./ai/gatewayModels";
import { extractReportFromImage } from "./reportExtractProvider";
import { generateObject } from "./ai/client";

vi.mock("./ai/client", () => ({
  generateObject: vi.fn(),
}));

const mockedGenerateObject = vi.mocked(generateObject);

function makeImageFile(): File {
  return new File(["pixels"], "screenshot-upload.jpg", {
    type: "image/jpeg",
  });
}

describe("report extract vision model regression", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    delete process.env.REPORT_EXTRACT_PROVIDER;
    delete process.env.REPORT_EXTRACT_OPENAI_MODEL;
    delete process.env.REPORT_EXTRACT_VISION_FALLBACK_MODEL;
  });

  it("rode basis: unset env default is google/gemini-2.5-flash", () => {
    vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "");
    expect(getReportExtractGatewayModel()).toBe("google/gemini-2.5-flash");
    expect(resolveReportExtractGatewayModel("").model).toBe(
      "google/gemini-2.5-flash",
    );
  });

  it("expliciete env gpt-5.6-sol blijft ongewijzigd", () => {
    vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "openai/gpt-5.6-sol");
    expect(getReportExtractGatewayModel()).toBe("openai/gpt-5.6-sol");
  });

  it("groen: vision-fallback na getypeerde primaire APICallError", async () => {
    vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "openai/gpt-5.6-sol");
    vi.stubEnv("REPORT_EXTRACT_VISION_FALLBACK_MODEL", "openai/gpt-6-luna");

    const apiErr = new APICallError({
      message: "upstream",
      url: "https://ai-gateway.vercel.sh/v1",
      requestBodyValues: {},
      statusCode: 502,
      responseHeaders: { "x-request-id": "req-502" },
      responseBody: "",
      isRetryable: false,
    });

    mockedGenerateObject.mockRejectedValueOnce(apiErr).mockResolvedValueOnce({
      object: {
        homeScore: 1,
        awayScore: 2,
        events: [],
      },
    } as never);

    const out = await extractReportFromImage(makeImageFile());
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2);
    const first = mockedGenerateObject.mock.calls[0][0] as { model: string };
    const second = mockedGenerateObject.mock.calls[1][0] as { model: string };
    expect(first.model).toBe("openai/gpt-5.6-sol");
    expect(second.model).toBe("openai/gpt-6-luna");
    expect(out.fallbackUsed).toBe(true);
    expect(out.model).toBe("openai/gpt-6-luna");
    expect(out.result.homeScore).toBe(1);
    expect(out.result.awayScore).toBe(2);
  });

  it("zonder fallback-config opnieuw throw na primaire fout", async () => {
    vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "openai/gpt-5.6-sol");
    vi.stubEnv("REPORT_EXTRACT_VISION_FALLBACK_MODEL", "none");
    mockedGenerateObject.mockRejectedValueOnce(
      new APICallError({
        message: "upstream",
        url: "u",
        requestBodyValues: {},
        statusCode: 502,
        responseHeaders: {},
        responseBody: "",
        isRetryable: false,
      }),
    );

    await expect(extractReportFromImage(makeImageFile())).rejects.toMatchObject(
      {
        code: "openai_failed",
        providerTelemetry: expect.objectContaining({
          failureKind: "transport",
          upstreamHttpStatus: 502,
        }),
      },
    );
    expect(mockedGenerateObject).toHaveBeenCalledTimes(1);
  });
});
