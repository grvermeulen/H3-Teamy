// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as reportRoute from "./route";
import { getReport, setReport } from "../../../lib/kv";

vi.mock("../../../lib/kv", () => ({
  getReport: vi.fn(),
  setReport: vi.fn(),
}));

vi.mock("../../../lib/activeUser", () => ({
  getActiveUser: vi.fn().mockResolvedValue({ userId: "anon-visitor" }),
}));

type RouteHandler = (req: NextRequest) => Promise<Response>;

const REPORT_URL = "http://localhost/api/report";
const EVENT_ID = "2026-11-08-wedstrijd";

/** Mirrors Next.js routing: a method without an exported handler gets 405. */
async function dispatch(
  method: "GET" | "POST",
  req: NextRequest,
): Promise<Response> {
  const handlers: Partial<Record<string, RouteHandler>> = reportRoute;
  const handler = handlers[method];
  if (!handler) return new Response(null, { status: 405 });
  return handler(req);
}

describe("/api/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an anonymous POST without overwriting the report", async () => {
    const req = new NextRequest(REPORT_URL, {
      method: "POST",
      body: JSON.stringify({ eventId: EVENT_ID, content: "Vervalst verslag" }),
      headers: { "content-type": "application/json" },
    });

    const res = await dispatch("POST", req);

    expect(res.status).toBe(405);
    expect(setReport).not.toHaveBeenCalled();
  });

  it("returns the stored report on GET", async () => {
    const report = {
      content: "Mooie overwinning",
      createdAt: "2026-11-08T21:00:00.000Z",
    };
    vi.mocked(getReport).mockResolvedValue(report);

    const res = await dispatch(
      "GET",
      new NextRequest(`${REPORT_URL}?eventId=${EVENT_ID}`),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ report });
    expect(getReport).toHaveBeenCalledWith(EVENT_ID);
  });

  it("returns 400 on GET without eventId", async () => {
    const res = await dispatch("GET", new NextRequest(REPORT_URL));

    expect(res.status).toBe(400);
    expect(getReport).not.toHaveBeenCalled();
  });
});
