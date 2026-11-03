import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { draftDrill } from "@/lib/ai/speelboekDraft";
import { checkRateLimit } from "@/lib/rateLimit";
import { isTrainer } from "@/lib/trainer";
import { POST } from "./route";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/trainer", () => ({ isTrainer: vi.fn() }));
vi.mock("@/lib/ai/speelboekDraft", () => ({ draftDrill: vi.fn() }));
vi.mock("@/lib/rateLimit", async (original) => ({
  ...(await original<typeof import("@/lib/rateLimit")>()),
  checkRateLimit: vi.fn(),
}));

const trainer = { isTrainer: true, me: { id: "t1", name: "Trainer" } };

function post(body: unknown): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/speelboek/ai/draft", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("POST /api/speelboek/ai/draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTrainer).mockResolvedValue(trainer);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true });
  });

  it("is trainer-only", async () => {
    vi.mocked(isTrainer).mockResolvedValue({
      isTrainer: false,
      me: { id: "p", name: "" },
    });
    expect((await POST(post({ description: "x" }))).status).toBe(403);
  });

  it("rate-limits per trainer", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSec: 30,
    });
    const res = await POST(post({ description: "4-2 man-meer" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "speelboek-ai-draft" }),
      "t1",
    );
  });

  it("requires a description or a photo", async () => {
    expect((await POST(post({ description: "   " }))).status).toBe(400);
    expect(
      (await POST(post({ imageDataUrl: "data:text/plain;base64,QUJD" })))
        .status,
    ).toBe(400);
  });

  it("returns the draft and warnings", async () => {
    vi.mocked(draftDrill).mockResolvedValue({
      draft: { title: "x" } as never,
      warnings: ["let op"],
    });
    const res = await POST(
      post({
        description: "Tip-in",
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      draft: { title: "x" },
      warnings: ["let op"],
    });
    expect(draftDrill).toHaveBeenCalledWith({
      description: "Tip-in",
      imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    });
  });
});
