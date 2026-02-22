import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { sendMatchReportToWhatsAppGroup } from "./waapiService";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("waapiService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends a message with group chat id and deep link", async () => {
    vi.stubEnv("WAAPI_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("WAAPI_BASE_URL", "https://waapi.app/api/v1");
    vi.stubEnv("WAAPI_INSTANCE_ID", "instance-123");
    vi.stubEnv("WAAPI_API_TOKEN", "token-abc");
    vi.stubEnv("WAAPI_GROUP_CHAT_ID", "1467733237@g.us");
    vi.stubEnv("APP_URL", "https://teamy.example");

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await sendMatchReportToWhatsAppGroup({
      eventId: "evt-1",
      opponentTeam: "Opponent",
      ourScore: 12,
      opponentScore: 9,
    });

    expect(result).toEqual({ sent: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://waapi.app/api/v1/instances/instance-123/client/action/send-message",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer token-abc",
      },
    });
    expect(init?.body).toContain("1467733237@g.us");
    expect(init?.body).toContain("https://teamy.example/report/evt-1");
  });

  it("returns missing_config when required env is absent", async () => {
    vi.stubEnv("WAAPI_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("WAAPI_INSTANCE_ID", "");
    vi.stubEnv("WAAPI_API_TOKEN", "");
    vi.stubEnv("WAAPI_GROUP_CHAT_ID", "");
    vi.stubEnv("APP_URL", "");

    const fetchSpy = vi.spyOn(global, "fetch");
    const result = await sendMatchReportToWhatsAppGroup({ eventId: "evt-1" });

    expect(result).toEqual({ sent: false, reason: "missing_config" });
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it("returns upstream_error when WaAPI responds with non-ok", async () => {
    vi.stubEnv("WAAPI_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("WAAPI_INSTANCE_ID", "instance-123");
    vi.stubEnv("WAAPI_API_TOKEN", "token-abc");
    vi.stubEnv("WAAPI_GROUP_CHAT_ID", "1467733237@g.us");
    vi.stubEnv("APP_URL", "https://teamy.example");

    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("Bad Request", { status: 400 }),
    );

    const result = await sendMatchReportToWhatsAppGroup({ eventId: "evt-1" });

    expect(result).toEqual({
      sent: false,
      reason: "upstream_error",
      details: "Bad Request",
    });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
  });

  it("captures exception when fetch throws", async () => {
    vi.stubEnv("WAAPI_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("WAAPI_INSTANCE_ID", "instance-123");
    vi.stubEnv("WAAPI_API_TOKEN", "token-abc");
    vi.stubEnv("WAAPI_GROUP_CHAT_ID", "1467733237@g.us");
    vi.stubEnv("APP_URL", "https://teamy.example");

    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network"));

    const result = await sendMatchReportToWhatsAppGroup({ eventId: "evt-1" });

    expect(result).toEqual({ sent: false, reason: "request_failed" });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
    );
  });
});
