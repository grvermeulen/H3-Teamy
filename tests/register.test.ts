import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/register/route";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import * as Sentry from "@sentry/nextjs";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: vi.fn((_ctx, cb) => cb()),
  captureException: vi.fn(),
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(),
  },
}));

const validBody = {
  email: "new@example.com",
  password: "password123",
  firstName: "Piet",
  lastName: "Pietersen",
  invitationCode: "test-invite-code",
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INVITATION_CODE", "test-invite-code");
    vi.mocked(bcrypt.hash).mockResolvedValue("hashed" as never);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "created-user-id",
      email: "new@example.com",
      firstName: "Piet",
      lastName: "Pietersen",
      passwordHash: "hashed",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
  });

  it("returns 400 and error when body is invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toEqual({
      error: "invalid_json",
      message: "Ongeldige JSON-invoer.",
    });
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await POST(makeRequest({ email: "a@b.nl" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(typeof data.error).toBe("string");
  });

  it("returns 400 when firstName is whitespace-only", async () => {
    const res = await POST(makeRequest({ ...validBody, firstName: "   \t  " }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toEqual({
      error: "voornaam mag niet alleen uit spaties bestaan",
    });
  });

  it("returns 400 when password is whitespace-only", async () => {
    const res = await POST(makeRequest({ ...validBody, password: "   " }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toEqual({
      error: "wachtwoord mag niet alleen uit spaties bestaan",
    });
  });

  it("returns 403 and error for invalid invitation code", async () => {
    const res = await POST(
      makeRequest({ ...validBody, invitationCode: "wrong-code" }),
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data).toEqual({ error: "ongeldige uitnodigingscode" });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 409 when email already exists", async () => {
    vi.mocked(prisma.user.create).mockRejectedValue({
      code: "P2002",
    } as never);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data).toEqual({
      error: "account bestaat al, gebruik wachtwoord vergeten",
    });
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });

  it("returns 200 and user id on successful registration", async () => {
    const uuid = "fixed-uuid-1234";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(uuid);

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, id: "created-user-id" });
    expect(vi.mocked(Sentry.startSpan)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bcrypt.hash)).toHaveBeenCalledWith("password123", 10);
    expect(vi.mocked(prisma.user.create)).toHaveBeenCalledWith({
      data: {
        email: "new@example.com",
        passwordHash: "hashed",
        firstName: "Piet",
        lastName: "Pietersen",
        id: uuid,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
});
