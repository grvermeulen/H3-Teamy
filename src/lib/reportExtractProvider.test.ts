import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  extractReportFromImage,
  ExtractProviderError,
  getExtractProviderConfig,
} from "./reportExtractProvider";

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
    vi.restoreAllMocks();
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
    it("uses VLM flow by default and returns normalized result", async () => {
      const fetchMock = vi.fn(async () =>
        mockJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
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
                    {
                      quarter: 7,
                      time: 123,
                      team: "bad",
                      type: "unknown",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const out = await extractReportFromImage(makeImageFile());
      expect(fetchMock).toHaveBeenCalledTimes(1);
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
        .mockResolvedValueOnce(mockJsonResponse({ raw_text: "RAW OCR TEXT" }))
        .mockResolvedValueOnce(
          mockJsonResponse({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    homeTeam: "Home",
                    awayTeam: "Away",
                    homeScore: 5,
                    awayScore: 4,
                  }),
                },
              },
            ],
          }),
        );
      global.fetch = fetchMock as unknown as typeof fetch;

      const out = await extractReportFromImage(makeImageFile());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(out.providerUsed).toBe("ocr");
      expect(out.fallbackUsed).toBe(false);
      expect(out.rawText).toBe("RAW OCR TEXT");
      expect(out.result.homeScore).toBe(5);
    });

    it("falls back to OCR in hybrid mode when VLM fails", async () => {
      process.env.REPORT_EXTRACT_PROVIDER = "hybrid";
      process.env.OCR_WORKER_URL = "https://ocr.example.com";
      process.env.OCR_WORKER_TOKEN = "ocr-token";

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(mockTextResponse("vlm failed", false))
        .mockResolvedValueOnce(mockJsonResponse({ raw_text: "OCR RAW" }))
        .mockResolvedValueOnce(
          mockJsonResponse({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    homeTeam: "Fallback Home",
                    awayTeam: "Fallback Away",
                  }),
                },
              },
            ],
          }),
        );
      global.fetch = fetchMock as unknown as typeof fetch;

      const out = await extractReportFromImage(makeImageFile());
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(out.providerUsed).toBe("ocr");
      expect(out.fallbackUsed).toBe(true);
      expect(out.rawText).toBe("OCR RAW");
      expect(out.result.homeTeam).toBe("Fallback Home");
    });

    it("surfaces OpenAI errors as typed provider errors", async () => {
      process.env.REPORT_EXTRACT_PROVIDER = "vlm";
      global.fetch = vi.fn(async () =>
        mockTextResponse("openai down", false),
      ) as unknown as typeof fetch;

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

    it("returns empty object when model response is non-JSON", async () => {
      global.fetch = vi.fn(async () =>
        mockJsonResponse({
          choices: [{ message: { content: "not json" } }],
        }),
      ) as unknown as typeof fetch;

      const out = await extractReportFromImage(makeImageFile());
      expect(out.result).toEqual({});
    });
  });
});
