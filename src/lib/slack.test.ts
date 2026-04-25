import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildWeeklyIdeaBlocks, postSlackBlocks } from "./slack";

describe("buildWeeklyIdeaBlocks", () => {
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
  const originalFetch = global.fetch;
  const originalEnv = process.env.SLACK_WEBHOOK_URL;

  beforeEach(() => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/abc";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.SLACK_WEBHOOK_URL = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns ok:false when SLACK_WEBHOOK_URL is missing", async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const r = await postSlackBlocks([{ type: "section" }]);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
  });

  it("posts to the webhook with text + blocks payload", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 200 }) as Response,
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await postSlackBlocks(
      [{ type: "section", text: { type: "mrkdwn", text: "hi" } }],
      "test",
    );
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.test/abc");
    const body = JSON.parse(String(init.body));
    expect(body.text).toBe("test");
    expect(Array.isArray(body.blocks)).toBe(true);
  });
});
