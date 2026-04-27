import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  extractReportFromImage,
  ExtractProviderError,
  getExtractProviderConfig,
} from "./reportExtractProvider";
import { generateObject } from "./ai/client";

vi.mock("./ai/client", () => ({
  generateObject: vi.fn(),
}));

const mockedGenerateObject = vi.mocked(generateObject);

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
    vi.restoreAllMocks();
    mockedGenerateObject.mockReset();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
    process.env.REPORT_EXTRACT_OPENAI_MODEL = "gpt-4o";
    delete process.env.OCR_WORKER_URL;
    delete process.env.OCR_WORKER_TOKEN;
    delete process.env.REPORT_EXTRACT_PROVIDER;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getExtractProviderConfig", () => {
    it("defaults to vlm when provider is missing", () => {
      const cfg = getExtractProviderConfig();
      expect(cfg.provider).toBe("vlm");
      expect(cfg.openAiModel).toBe("gpt-4o");
    });

    it("validates OCR env vars when provider is ocr", () => {
      process.env.REPORT_EXTRACT_PROVIDER = "ocr";
      expect(() => getExtractProviderConfig()).toThrowError(
        /OCR_WORKER_URL, OCR_WORKER_TOKEN/,
      );
    });

    it("throws a typed config error when required env vars are missing", () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.REPORT_EXTRACT_OPENAI_MODEL;
      try {
        getExtractProviderConfig();
        throw new Error("expected config error");
      } catch (error) {
        expect(error).toBeInstanceOf(ExtractProviderError);
        const typed = error as ExtractProviderError;
        expect(typed.code).toBe("extract_provider_config_invalid");
        expect(typed.status).toBe(500);
      }
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
      expect(out.result.homeTeam).toBe("De Rijn H3");
      expect(out.result.events).toHaveLength(1);
    });

    it("uses OCR flow when provider is ocr", async () => {
      process.env.REPORT_EXTRACT_PROVIDER = "ocr";
      process.env.OCR_WORKER_URL = "https://ocr.example.com";
      process.env.OCR_WORKER_TOKEN = "ocr-token";

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(mockJsonResponse({ raw_text: "RAW OCR TEXT" }));
      global.fetch = fetchMock as unknown as typeof fetch;

      mockedGenerateObject.mockResolvedValueOnce({
        object: {
          homeTeam: "Home",
          awayTeam: "Away",
          homeScore: 5,
          awayScore: 4,
        },
      } as never);

      const out = await extractReportFromImage(makeImageFile());
      expect(fetchMock).toHaveBeenCalledTimes(1);
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

    it("falls back to OCR in hybrid mode when VLM fails", async () => {
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

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(mockJsonResponse({ raw_text: "OCR RAW" }));
      global.fetch = fetchMock as unknown as typeof fetch;

      const out = await extractReportFromImage(makeImageFile());
      expect(mockedGenerateObject).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(out.providerUsed).toBe("ocr");
      expect(out.fallbackUsed).toBe(true);
      expect(out.rawText).toBe("OCR RAW");
      expect(out.result.homeTeam).toBe("Fallback Home");
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
      global.fetch = vi.fn(async () =>
        mockTextResponse("ocr down", false),
      ) as unknown as typeof fetch;

      await expect(
        extractReportFromImage(makeImageFile()),
      ).rejects.toMatchObject({
        code: "ocr_failed",
        status: 502,
      });
    });
  });
});
