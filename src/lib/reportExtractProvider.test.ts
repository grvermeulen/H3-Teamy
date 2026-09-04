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
    process.env.REPORT_EXTRACT_OPENAI_MODEL = "gpt-4o";
    delete process.env.OPENAI_API_KEY;
    delete process.env.OCR_WORKER_URL;
    delete process.env.OCR_WORKER_TOKEN;
    delete process.env.REPORT_EXTRACT_PROVIDER;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  describe("getExtractProviderConfig", () => {
    it("defaults to vlm when provider is missing", () => {
      const cfg = getExtractProviderConfig();
      expect(cfg.provider).toBe("vlm");
      expect(cfg.openAiModel).toBe("gpt-4o");
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

    it("defaults REPORT_EXTRACT_OPENAI_MODEL to gpt-4o when unset", () => {
      delete process.env.REPORT_EXTRACT_OPENAI_MODEL;
      const cfg = getExtractProviderConfig();
      expect(cfg.openAiModel).toBe("gpt-4o");
      expect(cfg.openAiModelSubstitutedFrom).toBeUndefined();
    });

    it("remaps removed gateway snapshot gpt-5.2-2025-12-11 to gpt-4o", () => {
      process.env.REPORT_EXTRACT_OPENAI_MODEL = "gpt-5.2-2025-12-11";
      const cfg = getExtractProviderConfig();
      expect(cfg.openAiModel).toBe("gpt-4o");
      expect(cfg.openAiModelSubstitutedFrom).toBe("gpt-5.2-2025-12-11");
    });

    it("remaps free-tier-blocked gpt-5-chat-latest to gpt-4o", () => {
      process.env.REPORT_EXTRACT_OPENAI_MODEL = "gpt-5-chat-latest";
      const cfg = getExtractProviderConfig();
      expect(cfg.openAiModel).toBe("gpt-4o");
      expect(cfg.openAiModelSubstitutedFrom).toBe("gpt-5-chat-latest");
    });
  });

  describe("resolveReportExtractOpenAiModel", () => {
    it("returns gpt-4o for empty input", () => {
      expect(resolveReportExtractOpenAiModel("")).toEqual({
        model: "gpt-4o",
      });
      expect(resolveReportExtractOpenAiModel("  ")).toEqual({
        model: "gpt-4o",
      });
    });

    it("remaps openai/-prefixed removed snapshot id", () => {
      expect(
        resolveReportExtractOpenAiModel("openai/gpt-5.2-2025-12-11"),
      ).toEqual({
        model: "gpt-4o",
        substitutedFrom: "openai/gpt-5.2-2025-12-11",
      });
    });

    it("remaps free-tier-blocked gpt-5-chat-latest", () => {
      expect(
        resolveReportExtractOpenAiModel("openai/gpt-5-chat-latest"),
      ).toEqual({
        model: "gpt-4o",
        substitutedFrom: "openai/gpt-5-chat-latest",
      });
    });

    it("passes through other model ids unchanged", () => {
      expect(resolveReportExtractOpenAiModel("gpt-4o-mini")).toEqual({
        model: "gpt-4o-mini",
      });
    });
  });

  describe("extractReportFromImage", () => {
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
      expect(args.messages[0].content[1].type).toBe("image");
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
      expect(normalizationArgs.prompt).toContain("RAW OCR TEXT");
      expect(out.providerUsed).toBe("ocr");
      expect(out.fallbackUsed).toBe(false);
      expect(out.rawText).toBe("RAW OCR TEXT");
      expect(out.result.homeScore).toBe(5);
    });

    it("uses gpt-4o gateway id when extract model env was a removed snapshot", async () => {
      process.env.REPORT_EXTRACT_OPENAI_MODEL = "gpt-5.2-2025-12-11";
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
      expect(args.model).toBe("openai/gpt-4o");
      expect(args.messages[0].content[1].type).toBe("image");
      expect(out.providerUsed).toBe("vlm");
      expect(out.fallbackUsed).toBe(false);
      expect(out.rawText).toBe("");
      expect(out.openAiModelSubstitutedFrom).toBe("gpt-5.2-2025-12-11");
      expect(out.result.homeTeam).toBe("A");
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
