import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildWeeklyIdeaBlocks, postSlackBlocks } from "./slack";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("buildWeeklyIdeaBlocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an empty-state block when there are no groups", () => {
    const blocks = buildWeeklyIdeaBlocks({}, "2026-04-18 → 2026-04-25");
    expect(blocks).toHaveLength(2);
    const last = blocks[1] as { type: string; text: { text: string } };
    expect(last.type).toBe("section");
    expect(last.text.text).toContain("No new ideas");
  });

  it("groups ideas by theme and uses summary when present", () => {
    const blocks = buildWeeklyIdeaBlocks(
      {
        "RSVP UX": [
          {
            title: "Bigger Yes button",
            body: "Make tap target bigger.",
            aiSummary: "Increase tap-target size on RSVP yes button.",
            aiTheme: "RSVP UX",
            aiImpact: "Medium",
            user: { firstName: "Sam", lastName: "Smith" },
          },
        ],
        Notifications: [
          {
            title: "Notify before training",
            body: "Push 1h before training",
            aiSummary: null,
            aiTheme: "Notifications",
            aiImpact: null,
            user: { firstName: "Jo", lastName: "" },
          },
        ],
      },
      "this week",
    );
    // header + (section + section + divider) * 2 = 7
    expect(blocks).toHaveLength(7);
    const themed = blocks.map((b) => JSON.stringify(b)).join("\n");
    expect(themed).toContain("RSVP UX");
    expect(themed).toContain("Notifications");
    expect(themed).toContain("Increase tap-target");
    expect(themed).toContain("Sam Smith");
    expect(themed).toContain("impact Medium");
  });
});

describe("postSlackBlocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/abc");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns ok:false when SLACK_WEBHOOK_URL is missing", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    const r = await postSlackBlocks([{ type: "section" }]);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
  });

  it("posts to the webhook with text + blocks payload", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const r = await postSlackBlocks(
      [{ type: "section", text: { type: "mrkdwn", text: "hi" } }],
      "test",
    );
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.test/abc");
    const body = JSON.parse(String(init.body));
    expect(body.text).toBe("test");
    expect(Array.isArray(body.blocks)).toBe(true);
  });

  it("returns ok:false and reports to Sentry when fetch throws", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
    const r = await postSlackBlocks([{ type: "section" }]);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
  });
});
