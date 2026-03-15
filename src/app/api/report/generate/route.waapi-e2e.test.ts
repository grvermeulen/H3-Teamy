import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { POST } from "./route";
import { getReport, kvGetJson, setReport } from "../../../../lib/kv";
import screenshotOne from "./__fixtures__/waapi-e2e-screenshot-1.json";
import screenshotTwo from "./__fixtures__/waapi-e2e-screenshot-2.json";
import screenshotThree from "./__fixtures__/waapi-e2e-screenshot-3.json";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../../lib/kv", () => ({
  getReport: vi.fn(),
  kvGetJson: vi.fn(),
  setReport: vi.fn(),
}));

type RawEvent = {
  quarter: 1 | 2 | 3 | 4;
  time: string;
  team: "home" | "away";
  type: "goal" | "personal_foul";
  player?: string;
};

type ScreenshotFixture = {
  screenshotLabel: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  date: string;
  events: RawEvent[];
};

type E2eCase = {
  eventId: string;
  fixture: ScreenshotFixture;
};

const screenshotCases: E2eCase[] = [
  {
    eventId: "e2e-waapi-zondag-16-februari-1800",
    fixture: screenshotOne as ScreenshotFixture,
  },
  {
    eventId: "e2e-waapi-zaterdag-15-maart-1818",
    fixture: screenshotTwo as ScreenshotFixture,
  },
  {
    eventId: "e2e-waapi-zaterdag-7-maart-1845",
    fixture: screenshotThree as ScreenshotFixture,
  },
];

function makeRequestBody(testCase: E2eCase): Record<string, unknown> {
  const { fixture } = testCase;
  return {
    eventId: testCase.eventId,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeScore: fixture.homeScore,
    awayScore: fixture.awayScore,
    date: fixture.date,
    events: fixture.events,
    result: {
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      homeScore: fixture.homeScore,
      awayScore: fixture.awayScore,
      date: fixture.date,
      events: fixture.events,
    },
  };
}

describe("POST /api/report/generate WAAPI e2e", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    vi.stubEnv("WAAPI_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("WAAPI_BASE_URL", "https://waapi.app/api/v1");
    vi.stubEnv("WAAPI_INSTANCE_ID", "instance-123");
    vi.stubEnv("WAAPI_API_TOKEN", "token-abc");
    vi.stubEnv("WAAPI_GROUP_CHAT_ID", "e2e-safe-group@g.us");
    vi.stubEnv("APP_URL", "https://teamy.example");

    vi.mocked(getReport).mockResolvedValue(null);
    vi.mocked(setReport).mockResolvedValue(undefined);
    vi.mocked(kvGetJson).mockImplementation(async (key: string) => {
      if (key === "users:roster:v2") {
        return [
          { id: "u1", name: "Arjan Verhoeven" },
          { id: "u2", name: "Kevin van den Elzen" },
          { id: "u3", name: "Jeroen Dekkers" },
          { id: "u4", name: "Frank Veldbrug" },
          { id: "u5", name: "Mats ter Hoeven" },
        ];
      }
      if (key === "calendar:events:v1") {
        return screenshotCases.map((testCase) => ({
          id: testCase.eventId,
          title: `${testCase.fixture.homeTeam} - ${testCase.fixture.awayTeam}`,
        }));
      }
      return null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("generates reports and sends WAAPI notifications for all 3 screenshot fixtures safely", async () => {
    const waapiBodies: Array<{ chatId?: string; message?: string }> = [];

    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://api.openai.com/v1/responses") {
        return new Response(
          JSON.stringify({
            output_text:
              "Sterk teamverslag voor de testflow.\nDe MVP-stemming staat nog open via de knop hieronder!",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.includes("/client/action/send-message")) {
        const payload =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as { chatId?: string; message?: string })
            : {};
        waapiBodies.push(payload);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch URL in e2e test: ${url}`);
    });

    for (const testCase of screenshotCases) {
      const req = new Request("http://localhost/api/report/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(makeRequestBody(testCase)),
      });

      const response = await POST(req as NextRequest);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true });
    }

    expect(waapiBodies).toHaveLength(3);
    for (const [index, testCase] of screenshotCases.entries()) {
      expect(waapiBodies[index]?.chatId).toBe("e2e-safe-group@g.us");
      expect(waapiBodies[index]?.message).toContain(
        `/report/${encodeURIComponent(testCase.eventId)}`,
      );
    }

    expect(vi.mocked(setReport)).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(setReport).mock.calls) {
      const eventId = call[0];
      expect(eventId).toMatch(/^e2e-waapi-/);
    }
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(0);
  });

  it("captures a Sentry signal when notification is not sent", async () => {
    vi.stubEnv("WAAPI_NOTIFICATIONS_ENABLED", "false");

    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://api.openai.com/v1/responses") {
        return new Response(
          JSON.stringify({
            output_text:
              "Verslag zonder WAAPI-send.\nDe MVP-stemming staat nog open via de knop hieronder!",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`Unexpected fetch URL in e2e test: ${url}`);
    });

    const testCase = screenshotCases[0];
    const req = new Request("http://localhost/api/report/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRequestBody(testCase)),
    });

    const response = await POST(req as NextRequest);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setReport)).toHaveBeenCalledWith(
      expect.stringMatching(/^e2e-waapi-/),
      expect.any(Object),
    );
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("WaAPI notification not sent: disabled"),
      }),
    );
  });
});
