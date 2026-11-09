import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import {
  extractReportFromImage,
  ExtractProviderError,
  getExtractProviderConfig,
  resolveReportExtractOpenAiModel,
} from "./reportExtractProvider";
import { generateObject } from "./ai/client";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("./ai/client", () => ({
  generateObject: vi.fn(),
}));

const mockedGenerateObject = vi.mocked(generateObject);
const mockedSentryCapture = vi.mocked(Sentry.captureException);

function mockJsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function mockTextResponse(text: string, ok = true): Response {
  return {
    ok,
    json: async () => ({}),
    text: async () => text,
  } as Response;
}

function makeImageFile(name = "match.png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

describe("reportExtractProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGenerateObject.mockReset();
    mockedSentryCapture.mockReset();
    process.env = { ...originalEnv };
    vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "gpt-4o");
    delete process.env.OPENAI_API_KEY;
    delete process.env.OCR_WORKER_URL;
    delete process.env.OCR_WORKER_TOKEN;
    delete process.env.REPORT_EXTRACT_PROVIDER;
    vi.stubEnv("REPORT_EXTRACT_VISION_FALLBACK_MODEL", "none");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
  });

  describe("getExtractProviderConfig", () => {
    it("defaults to vlm when provider is missing", () => {
      const cfg = getExtractProviderConfig();
      expect(cfg.provider).toBe("vlm");
      expect(cfg.openAiModel).toBe("openai/gpt-4o");
    });

    it("does not require OPENAI_API_KEY (gateway handles auth)", () => {
      // OPENAI_API_KEY is intentionally unset in beforeEach.
      const cfg = getExtractProviderConfig();
      expect(cfg.provider).toBe("vlm");
    });

    it("validates OCR env vars when provider is ocr", () => {
      process.env.REPORT_EXTRACT_PROVIDER = "ocr";
      expect(() => getExtractProviderConfig()).toThrowError(
        /OCR_WORKER_URL, OCR_WORKER_TOKEN/,
      );
    });

    it("defaults REPORT_EXTRACT_OPENAI_MODEL to gemini-2.5-flash when unset", () => {
      vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "");
      const cfg = getExtractProviderConfig();
      expect(cfg.openAiModel).toBe("google/gemini-2.5-flash");
      expect(cfg.openAiModelSubstitutedFrom).toBeUndefined();
    });

    it("remaps removed gateway snapshot to gemini default", () => {
      vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "gpt-5.2-2025-12-11");
      const cfg = getExtractProviderConfig();
      expect(cfg.openAiModel).toBe("google/gemini-2.5-flash");
      expect(cfg.openAiModelSubstitutedFrom).toBe("gpt-5.2-2025-12-11");
    });

    it("remaps the legacy chat alias to gemini default", () => {
      vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "gpt-5-chat-latest");
      const cfg = getExtractProviderConfig();
      expect(cfg.openAiModel).toBe("google/gemini-2.5-flash");
      expect(cfg.openAiModelSubstitutedFrom).toBe("gpt-5-chat-latest");
    });

    it("honors expliciete gpt-5.6-sol env zonder stille herschrijving", () => {
      vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "gpt-5.6-sol");
      const cfg = getExtractProviderConfig();
      expect(cfg.openAiModel).toBe("openai/gpt-5.6-sol");
      expect(cfg.openAiModelSubstitutedFrom).toBeUndefined();
    });

    it("gebruikt standaard luna-fallback wanneer env ontbreekt", () => {
      vi.unstubAllEnvs();
      vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "gpt-4o");
      delete process.env.REPORT_EXTRACT_VISION_FALLBACK_MODEL;
      const cfg = getExtractProviderConfig();
      expect(cfg.visionFallbackModel).toBe("openai/gpt-6-luna");
    });

    it("leest vision-fallback uit REPORT_EXTRACT_VISION_FALLBACK_MODEL", () => {
      vi.stubEnv("REPORT_EXTRACT_VISION_FALLBACK_MODEL", "gpt-4o");
      const cfg = getExtractProviderConfig();
      expect(cfg.visionFallbackModel).toBe("openai/gpt-4o");
    });

    it("bevat anthropic/claude-sonnet-4-6 ongewijzigd", () => {
      vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "claude-sonnet-4-6");
      const cfg = getExtractProviderConfig();
      expect(cfg.openAiModel).toBe("anthropic/claude-sonnet-4.6");
      expect(cfg.openAiModelSubstitutedFrom).toBeUndefined();
    });
  });

  describe("resolveReportExtractOpenAiModel", () => {
    it("returns gemini default for empty input", () => {
      expect(resolveReportExtractOpenAiModel("")).toEqual({
        model: "google/gemini-2.5-flash",
      });
      expect(resolveReportExtractOpenAiModel("  ")).toEqual({
        model: "google/gemini-2.5-flash",
      });
    });

    it("remaps openai/-prefixed removed snapshot id", () => {
      expect(
        resolveReportExtractOpenAiModel("openai/gpt-5.2-2025-12-11"),
      ).toEqual({
        model: "google/gemini-2.5-flash",
        substitutedFrom: "openai/gpt-5.2-2025-12-11",
      });
    });

    it("remaps free-tier-blocked gpt-5-chat-latest", () => {
      expect(
        resolveReportExtractOpenAiModel("openai/gpt-5-chat-latest"),
      ).toEqual({
        model: "google/gemini-2.5-flash",
        substitutedFrom: "openai/gpt-5-chat-latest",
      });
    });

    it("passes through other openai model ids unchanged", () => {
      expect(resolveReportExtractOpenAiModel("gpt-4o-mini")).toEqual({
        model: "openai/gpt-4o-mini",
      });
    });

    it("passes through google gemini ids", () => {
      expect(
        resolveReportExtractOpenAiModel("google/gemini-2.5-flash"),
      ).toEqual({ model: "google/gemini-2.5-flash" });
    });

    it("passes through bare Claude ids on anthropic provider", () => {
      expect(resolveReportExtractOpenAiModel("claude-sonnet-4-6")).toEqual({
        model: "anthropic/claude-sonnet-4.6",
      });
    });

    it("remaps Claude ids when incorrectly prefixed as OpenAI", () => {
      expect(
        resolveReportExtractOpenAiModel("openai/claude-sonnet-4-6"),
      ).toEqual({
        model: "google/gemini-2.5-flash",
        substitutedFrom: "openai/claude-sonnet-4-6",
      });
    });
  });

  describe("extractReportFromImage", () => {
    it("labels vision failures with providerUsed vlm", async () => {
      const { APICallError } = await import("ai");
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

      await expect(
        extractReportFromImage(makeImageFile()),
      ).rejects.toMatchObject({
        code: "openai_failed",
        providerUsed: "vlm",
      });
    });

    it("uses VLM flow by default and returns parsed result via the AI SDK", async () => {
      mockedGenerateObject.mockResolvedValueOnce({
        object: {
          homeTeam: "De Rijn H3",
          awayTeam: "Opponent",
          homeScore: 12,
          awayScore: 9,
          events: [
            {
              quarter: 1,
              time: "07:12",
              team: "home",
              type: "goal",
              player: "Player A",
            },
          ],
        },
      } as never);

      const out = await extractReportFromImage(makeImageFile());
      expect(mockedGenerateObject).toHaveBeenCalledTimes(1);
      const args = mockedGenerateObject.mock.calls[0][0] as {
        model: string;
        messages: Array<{ content: Array<{ type: string }> }>;
      };
      expect(args.model).toBe("openai/gpt-4o");
      expect(args).not.toHaveProperty("temperature");
      expect(args.messages[0].content[1].type).toBe("file");
      expect(out.providerUsed).toBe("vlm");
      expect(out.fallbackUsed).toBe(false);
      expect(out.rawText).toBe("");
      expect(out.openAiModelSubstitutedFrom).toBeUndefined();
      expect(out.result.homeTeam).toBe("De Rijn H3");
      expect(out.result.events).toHaveLength(1);
    });

    it("uses OCR flow when provider is ocr", async () => {
      process.env.REPORT_EXTRACT_PROVIDER = "ocr";
      process.env.OCR_WORKER_URL = "https://ocr.example.com";
      process.env.OCR_WORKER_TOKEN = "ocr-token";

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(mockJsonResponse({ raw_text: "RAW OCR TEXT" }));

      mockedGenerateObject.mockResolvedValueOnce({
        object: {
          homeTeam: "Home",
          awayTeam: "Away",
          homeScore: 5,
          awayScore: 4,
        },
      } as never);

      const out = await extractReportFromImage(makeImageFile());
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(mockedGenerateObject).toHaveBeenCalledTimes(1);
      const normalizationArgs = mockedGenerateObject.mock.calls[0][0] as {
        prompt: string;
      };
      expect(normalizationArgs).not.toHaveProperty("temperature");
      expect(normalizationArgs.prompt).toContain("RAW OCR TEXT");
      expect(out.providerUsed).toBe("ocr");
      expect(out.fallbackUsed).toBe(false);
      expect(out.rawText).toBe("RAW OCR TEXT");
      expect(out.result.homeScore).toBe(5);
    });

    it("uses gemini default when extract model env was a removed snapshot", async () => {
      vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "gpt-5.2-2025-12-11");
      mockedGenerateObject.mockResolvedValueOnce({
        object: {
          homeTeam: "A",
          awayTeam: "B",
        },
      } as never);

      const out = await extractReportFromImage(makeImageFile());
      expect(mockedGenerateObject).toHaveBeenCalledTimes(1);
      const args = mockedGenerateObject.mock.calls[0][0] as {
        model: string;
        messages: Array<{ content: Array<{ type: string }> }>;
      };
      expect(args.model).toBe("google/gemini-2.5-flash");
      expect(args.messages[0].content[1].type).toBe("file");
      expect(out.providerUsed).toBe("vlm");
      expect(out.fallbackUsed).toBe(false);
      expect(out.rawText).toBe("");
      expect(out.openAiModelSubstitutedFrom).toBe("gpt-5.2-2025-12-11");
      expect(out.result.homeTeam).toBe("A");
    });

    it("roept anthropic/claude-sonnet-4.6 aan wanneer env dat vraagt", async () => {
      vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "claude-sonnet-4-6");
      mockedGenerateObject.mockResolvedValueOnce({
        object: {
          homeTeam: "A",
          awayTeam: "B",
        },
      } as never);

      const out = await extractReportFromImage(makeImageFile());
      expect(mockedGenerateObject).toHaveBeenCalledTimes(1);
      const args = mockedGenerateObject.mock.calls[0][0] as {
        model: string;
      };
      expect(args.model).toBe("anthropic/claude-sonnet-4.6");
      expect(out.model).toBe("anthropic/claude-sonnet-4.6");
      expect(out.openAiModelSubstitutedFrom).toBeUndefined();
    });

    it("behoudt vision fallbackUsed in hybrid mode na succesvolle VLM-retry", async () => {
      process.env.REPORT_EXTRACT_PROVIDER = "hybrid";
      process.env.OCR_WORKER_URL = "https://ocr.example.com";
      process.env.OCR_WORKER_TOKEN = "ocr-token";
      vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "openai/gpt-5.6-sol");
      vi.stubEnv("REPORT_EXTRACT_VISION_FALLBACK_MODEL", "openai/gpt-6-luna");
      const { APICallError } = await import("ai");

      mockedGenerateObject
        .mockRejectedValueOnce(
          new APICallError({
            message: "upstream",
            url: "u",
            requestBodyValues: {},
            statusCode: 502,
            responseHeaders: {},
            responseBody: "",
            isRetryable: false,
          }),
        )
        .mockResolvedValueOnce({
          object: { homeTeam: "H", awayTeam: "A", homeScore: 1, awayScore: 2 },
        } as never);

      const out = await extractReportFromImage(makeImageFile());
      expect(out.fallbackUsed).toBe(true);
      expect(out.providerUsed).toBe("vlm");
    });

    it("falls back to OCR in hybrid mode when VLM fails and reports the failure to Sentry", async () => {
      process.env.REPORT_EXTRACT_PROVIDER = "hybrid";
      process.env.OCR_WORKER_URL = "https://ocr.example.com";
      process.env.OCR_WORKER_TOKEN = "ocr-token";

      mockedGenerateObject
        .mockRejectedValueOnce(new Error("vlm down"))
        .mockResolvedValueOnce({
          object: {
            homeTeam: "Fallback Home",
            awayTeam: "Fallback Away",
          },
        } as never);

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(mockJsonResponse({ raw_text: "OCR RAW" }));

      const out = await extractReportFromImage(makeImageFile());
      expect(mockedGenerateObject).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(out.providerUsed).toBe("ocr");
      expect(out.fallbackUsed).toBe(true);
      expect(out.rawText).toBe("OCR RAW");
      expect(out.result.homeTeam).toBe("Fallback Home");
      expect(mockedSentryCapture).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          level: "warning",
          tags: expect.objectContaining({
            module: "report_extract",
            provider: "vlm",
            operation: "hybrid_fallback",
          }),
        }),
      );
    });

    it("surfaces OpenAI errors as typed provider errors", async () => {
      process.env.REPORT_EXTRACT_PROVIDER = "vlm";
      mockedGenerateObject.mockRejectedValueOnce(new Error("openai down"));

      await expect(
        extractReportFromImage(makeImageFile()),
      ).rejects.toMatchObject({
        code: "openai_failed",
        status: 502,
      });
    });

    it("retries met REPORT_EXTRACT_VISION_FALLBACK_MODEL na primaire VLM-fout", async () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      vi.stubEnv("REPORT_EXTRACT_OPENAI_MODEL", "google/gemini-2.5-flash");
      vi.stubEnv("REPORT_EXTRACT_VISION_FALLBACK_MODEL", "openai/gpt-6-luna");
      const { APICallError } = await import("ai");
      mockedGenerateObject
        .mockRejectedValueOnce(
          new APICallError({
            message: "quota",
            url: "u",
            requestBodyValues: {},
            statusCode: 429,
            responseHeaders: {},
            responseBody: "",
            isRetryable: false,
          }),
        )
        .mockResolvedValueOnce({
          object: {
            homeTeam: "Home",
            awayTeam: "Away",
            homeScore: 1,
            awayScore: 0,
            events: [],
          },
        } as never);

      const out = await extractReportFromImage(makeImageFile());
      expect(mockedGenerateObject).toHaveBeenCalledTimes(2);
      expect(
        (mockedGenerateObject.mock.calls[1][0] as { model: string }).model,
      ).toBe("openai/gpt-6-luna");
      expect(out.fallbackUsed).toBe(true);
      expect(out.model).toBe("openai/gpt-6-luna");
      expect(out.result.homeTeam).toBe("Home");

      const fallbackTrace = infoSpy.mock.calls
        .map((c) => c[1])
        .find(
          (p) =>
            typeof p === "object" &&
            p !== null &&
            (p as { phase?: string }).phase === "vision_model_fallback",
        ) as
        | {
            errorClass?: string;
            provider?: { fallbackModel?: string; model?: string };
          }
        | undefined;
      expect(fallbackTrace?.provider?.model).toBe("google/gemini-2.5-flash");
      expect(fallbackTrace?.provider?.fallbackModel).toBe("openai/gpt-6-luna");
      expect(fallbackTrace?.errorClass).toBeDefined();
      infoSpy.mockRestore();
    });

    it("surfaces OCR worker errors as typed provider errors", async () => {
      process.env.REPORT_EXTRACT_PROVIDER = "ocr";
      process.env.OCR_WORKER_URL = "https://ocr.example.com";
      process.env.OCR_WORKER_TOKEN = "ocr-token";
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        mockTextResponse("ocr down", false),
      );

      await expect(
        extractReportFromImage(makeImageFile()),
      ).rejects.toMatchObject({
        code: "ocr_failed",
        status: 502,
      });
    });
  });
});
