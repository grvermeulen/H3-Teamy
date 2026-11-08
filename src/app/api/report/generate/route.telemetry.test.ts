// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock("../../../../lib/kv", () => ({
  getReport: vi.fn(async () => null),
  setReport: vi.fn(async () => undefined),
  kvGetJson: vi.fn(async () => []),
}));

vi.mock("../../../../lib/services/waapiService", () => ({
  sendMatchReportToWhatsAppGroup: vi.fn(async () => ({
    sent: false,
    reason: "disabled",
  })),
}));

vi.mock("../../../../lib/services/userService", () => ({
  getActiveUsers: vi.fn(async () => []),
}));

const generateText = vi.fn();
vi.mock("../../../../lib/ai/client", () => ({
  generateText: (...args: unknown[]) => generateText(...args),
}));

describe("POST /api/report/generate telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateText.mockResolvedValue({ text: "Verslag tekst." });
  });

  function makeRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest(
      new Request("http://localhost/api/report/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Report-Flow-Id": "11111111-1111-4111-8111-111111111111",
        },
        body: JSON.stringify(body),
      }),
    );
  }

  it("logt validate_fail bij incomplete input", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await POST(
      makeRequest({
        eventId: "evt-1",
        reportFlowId: "11111111-1111-4111-8111-111111111111",
        homeScore: 1,
        awayScore: 2,
      }),
    );
    expect(response.status).toBe(422);
    const flowRows = infoSpy.mock.calls
      .map((c) => c[1])
      .filter(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          (p as { event?: string }).event === "report_flow_trace",
      ) as { phase?: string; flowId?: string; scope?: string }[];
    expect(flowRows.some((r) => r.phase === "validate_fail")).toBe(true);
    expect(
      flowRows.some((r) => r.flowId === "11111111-1111-4111-8111-111111111111"),
    ).toBe(true);
    const body = await response.json();
    expect(body.diagnostic?.supportRef).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/i);
    infoSpy.mockRestore();
  });

  it("logt ai_fail met providerTelemetry bij generateText fout", async () => {
    const { APICallError } = await import("ai");
    generateText.mockRejectedValue(
      new APICallError({
        message: "upstream",
        url: "u",
        requestBodyValues: {},
        statusCode: 502,
        responseHeaders: { "x-request-id": "up-req" },
        responseBody: "SECRET",
        isRetryable: false,
      }),
    );
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await POST(
      makeRequest({
        eventId: "evt-1",
        reportFlowId: "11111111-1111-4111-8111-111111111111",
        homeScore: 3,
        awayScore: 4,
        events: [
          {
            quarter: 1,
            time: "12:00",
            team: "home",
            type: "goal",
          },
        ],
      }),
    );
    expect(response.status).toBe(502);
    const fail = infoSpy.mock.calls
      .map((c) => c[1])
      .find(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          (p as { phase?: string }).phase === "ai_fail",
      ) as
      | {
          providerTelemetry?: { upstreamHttpStatus?: number };
          appHttpStatus?: number;
        }
      | undefined;
    expect(fail?.providerTelemetry?.upstreamHttpStatus).toBe(502);
    expect(fail?.appHttpStatus).toBe(502);
    infoSpy.mockRestore();
  });
});
