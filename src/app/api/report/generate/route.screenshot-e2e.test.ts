import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { POST } from "./route";
import { getReport, kvGetJson, setReport } from "../../../../lib/kv";
import { generateText } from "../../../../lib/ai/client";
import screenshotOne from "./__fixtures__/screenshot-1.json";
import screenshotTwo from "./__fixtures__/screenshot-2.json";
import screenshotThree from "./__fixtures__/screenshot-3.json";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  setTag: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock("../../../../lib/kv", () => ({
  getReport: vi.fn(),
  kvGetJson: vi.fn(),
  setReport: vi.fn(),
}));

vi.mock("../../../../lib/ai/client", () => ({
  generateText: vi.fn(),
}));

const mockedGenerateText = vi.mocked(generateText);

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
    eventId: "e2e-zondag-16-februari-1800",
    fixture: screenshotOne as ScreenshotFixture,
  },
  {
    eventId: "e2e-zaterdag-15-maart-1818",
    fixture: screenshotTwo as ScreenshotFixture,
  },
  {
    eventId: "e2e-zaterdag-7-maart-1845",
    fixture: screenshotThree as ScreenshotFixture,
  },
];

function makeRequest(testCase: E2eCase): NextRequest {
  const { fixture } = testCase;
  const match = {
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeScore: fixture.homeScore,
    awayScore: fixture.awayScore,
    date: fixture.date,
    events: fixture.events,
  };
  return new NextRequest(
    new Request("http://localhost/api/report/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventId: testCase.eventId,
        ...match,
        result: match,
      }),
    }),
  );
}

describe("POST /api/report/generate screenshot e2e", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");

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
    mockedGenerateText.mockResolvedValue({
      text: "Sterk teamverslag voor de testflow.\nDe MVP-stemming staat nog open via de knop hieronder!",
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("saves a report for each screenshot without contacting anything outside", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : input.url;
        throw new Error(`Unexpected fetch URL in e2e test: ${url}`);
      });

    for (const testCase of screenshotCases) {
      const response = await POST(makeRequest(testCase));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true });
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.mocked(setReport)).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(setReport).mock.calls) {
      expect(call[0]).toMatch(/^e2e-/);
    }
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("returns the opponent and the score from our side for sharing", async () => {
    const response = await POST(makeRequest(screenshotCases[0]));

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.match).toEqual({
      opponentTeam: "Mierlo-Hout H1",
      ourScore: 13,
      opponentScore: 7,
    });
    expect(body).not.toHaveProperty("whatsappNotification");
  });
});
