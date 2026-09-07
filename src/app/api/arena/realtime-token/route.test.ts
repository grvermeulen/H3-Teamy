import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveUser = vi.fn();
const createTokenRequest = vi.fn();
const captureException = vi.fn();

vi.mock("../../../../lib/activeUser", () => ({
  getActiveUser: (...args: unknown[]) => getActiveUser(...args),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));
vi.mock("ably", () => ({
  Rest: class {
    auth = {
      createTokenRequest: (...args: unknown[]) => createTokenRequest(...args),
    };
  },
}));

const { GET } = await import("./route");

/** A well-formed token request, as Ably's SDK returns one. */
const TOKEN_REQUEST = {
  keyName: "app.key",
  clientId: "user-1",
  ttl: 3600000,
  timestamp: 1_700_000_000_000,
  capability: '{"arena:room:*":["publish","subscribe","presence"]}',
  nonce: "abc123",
  mac: "signature",
};

/** A request with no cookies, which is all the route reads directly. */
function request(): NextRequest {
  return new NextRequest("http://localhost/api/arena/realtime-token");
}

describe("GET /api/arena/realtime-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ABLY_API_KEY", "app.key:secret");
    getActiveUser.mockResolvedValue({ userId: "user-1", needsLink: false });
    createTokenRequest.mockResolvedValue(TOKEN_REQUEST);
  });

  it("signs a token request for the signed-in user", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.clientId).toBe("user-1");
    expect(body.tokenRequest.mac).toBe("signature");
  });

  it("asks Ably for the user's own clientId and the arena capability", async () => {
    await GET(request());
    const options = createTokenRequest.mock.calls[0]?.[0] as {
      clientId: string;
      ttl: number;
      capability: Record<string, string[]>;
    };
    expect(options.clientId).toBe("user-1");
    expect(options.ttl).toBe(60 * 60 * 1000);
    expect(options.capability["arena:room:*"]).toEqual([
      "publish",
      "subscribe",
      "presence",
    ]);
    expect(options.capability["arena:lobby"]).toEqual([
      "subscribe",
      "presence",
    ]);
  });

  it("never lets the API key reach the response", async () => {
    const body = await (await GET(request())).text();
    expect(body).not.toContain("secret");
  });

  it("reports a missing key to Sentry and answers in Dutch", async () => {
    vi.stubEnv("ABLY_API_KEY", "");
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe(
      "Kon geen verbinding maken, probeer het later opnieuw",
    );
    expect(captureException).toHaveBeenCalled();
  });

  it("reports an Ably failure to Sentry and returns 502 rather than throwing", async () => {
    createTokenRequest.mockRejectedValue(new Error("ably is down"));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "realtime-token" },
      }),
    );
  });

  it("rejects a token request whose shape is not what the client expects", async () => {
    createTokenRequest.mockResolvedValue({ keyName: "app.key" });
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(captureException).toHaveBeenCalled();
  });

  it("reports an auth failure to Sentry and returns 500", async () => {
    getActiveUser.mockRejectedValue(new Error("no session"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(captureException).toHaveBeenCalled();
  });
});
