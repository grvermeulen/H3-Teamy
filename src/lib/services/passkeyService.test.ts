import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { prisma } from "../db";
import { webAuthnConsumeChallenge, webAuthnStoreChallenge } from "../kv";
import { resolveWebAuthnRpConfig } from "../webAuthnEnv";
import {
  deletePasskeyForUser,
  finishPasskeyLogin,
  finishPasskeyRegistration,
  listPasskeysForUser,
  startPasskeyLogin,
  startPasskeyRegistration,
} from "./passkeyService";

vi.mock("../db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    passkey: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../kv", () => ({
  webAuthnStoreChallenge: vi.fn(),
  webAuthnConsumeChallenge: vi.fn(),
}));

vi.mock("../webAuthnEnv", () => ({
  resolveWebAuthnRpConfig: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

function makeRequest(
  url = "http://localhost:3000/api/auth/passkey",
): NextRequest {
  return new NextRequest(url, {
    headers: { host: "localhost:3000" },
  });
}

describe("passkeyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWebAuthnRpConfig).mockReturnValue({
      rpID: "localhost",
      rpName: "H3 Teamy",
    });
  });

  describe("startPasskeyRegistration", () => {
    it("stores a registration challenge and returns options", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        email: "speler@example.test",
        firstName: "Jan",
        lastName: "Jansen",
      });
      vi.mocked(prisma.passkey.findMany).mockResolvedValue([]);
      vi.mocked(generateRegistrationOptions).mockResolvedValue({
        challenge: "reg-challenge",
        rp: { name: "H3 Teamy", id: "localhost" },
        user: {
          id: "user-1",
          name: "speler@example.test",
          displayName: "Jan Jansen",
        },
        pubKeyCredParams: [],
        timeout: 60000,
        attestation: "none",
        excludeCredentials: [],
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      });

      const req = makeRequest();
      const result = await startPasskeyRegistration("user-1", req);

      expect(generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: "localhost",
          rpName: "H3 Teamy",
          userName: "speler@example.test",
          userDisplayName: "Jan Jansen",
        }),
      );
      expect(webAuthnStoreChallenge).toHaveBeenCalledWith(
        "registration",
        "user-1",
        "reg-challenge",
      );
      expect(result.optionsJSON.challenge).toBe("reg-challenge");
    });

    it("throws user_not_found when the user does not exist", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(
        startPasskeyRegistration("missing", makeRequest()),
      ).rejects.toThrow("user_not_found");
    });
  });

  describe("startPasskeyLogin", () => {
    it("stores an authentication challenge with a login session id", async () => {
      vi.mocked(generateAuthenticationOptions).mockResolvedValue({
        challenge: "auth-challenge",
        timeout: 60000,
        rpId: "localhost",
        allowCredentials: [],
        userVerification: "preferred",
      });

      const result = await startPasskeyLogin(makeRequest());

      expect(result.optionsJSON.challenge).toBe("auth-challenge");
      expect(result.loginSessionId).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(webAuthnStoreChallenge).toHaveBeenCalledWith(
        "authentication",
        result.loginSessionId,
        "auth-challenge",
      );
    });
  });

  describe("finishPasskeyRegistration", () => {
    const response = {
      id: "cred-id",
      rawId: "cred-id",
      type: "public-key",
      response: {
        clientDataJSON: "client",
        attestationObject: "attest",
      },
      clientExtensionResults: {},
    };

    it("returns challenge_missing when no challenge was stored", async () => {
      vi.mocked(webAuthnConsumeChallenge).mockResolvedValue(null);

      const result = await finishPasskeyRegistration(
        "user-1",
        response,
        ["http://localhost:3000"],
        makeRequest(),
      );

      expect(result).toEqual({ ok: false, error: "challenge_missing" });
    });

    it("persists the credential after successful verification", async () => {
      vi.mocked(webAuthnConsumeChallenge).mockResolvedValue("reg-challenge");
      vi.mocked(verifyRegistrationResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: "cred-id",
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ["internal"],
          },
        },
      });
      vi.mocked(prisma.passkey.create).mockResolvedValue({
        id: "pk-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: "user-1",
        credentialId: "cred-id",
        publicKey: Buffer.from([1, 2, 3]),
        counter: 0,
        transports: '["internal"]',
        label: null,
      });

      const result = await finishPasskeyRegistration(
        "user-1",
        response,
        ["http://localhost:3000"],
        makeRequest(),
      );

      expect(verifyRegistrationResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          response,
          expectedChallenge: "reg-challenge",
          expectedOrigin: ["http://localhost:3000"],
          expectedRPID: "localhost",
        }),
      );
      expect(prisma.passkey.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true });
    });
  });

  describe("finishPasskeyLogin", () => {
    const response = {
      id: "cred-id",
      rawId: "cred-id",
      type: "public-key",
      response: {
        clientDataJSON: "client",
        authenticatorData: "auth",
        signature: "sig",
      },
      clientExtensionResults: {},
    };

    it("returns challenge_missing when the login session expired", async () => {
      vi.mocked(webAuthnConsumeChallenge).mockResolvedValue(null);

      const result = await finishPasskeyLogin(
        response,
        "session-1",
        ["http://localhost:3000"],
        makeRequest(),
      );

      expect(result).toEqual({ error: "challenge_missing" });
    });

    it("returns credential_unknown when the passkey is not registered", async () => {
      vi.mocked(webAuthnConsumeChallenge).mockResolvedValue("auth-challenge");
      vi.mocked(prisma.passkey.findUnique).mockResolvedValue(null);

      const result = await finishPasskeyLogin(
        response,
        "session-1",
        ["http://localhost:3000"],
        makeRequest(),
      );

      expect(result).toEqual({ error: "credential_unknown" });
    });

    it("updates the counter and returns the user id after verification", async () => {
      vi.mocked(webAuthnConsumeChallenge).mockResolvedValue("auth-challenge");
      vi.mocked(prisma.passkey.findUnique).mockResolvedValue({
        userId: "user-1",
        credentialId: "cred-id",
        publicKey: Buffer.from([1, 2, 3]),
        counter: 1,
      });
      vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: {
          newCounter: 2,
        },
      });
      vi.mocked(prisma.passkey.update).mockResolvedValue({
        id: "pk-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: "user-1",
        credentialId: "cred-id",
        publicKey: Buffer.from([1, 2, 3]),
        counter: 2,
        transports: null,
        label: null,
      });

      const result = await finishPasskeyLogin(
        response,
        "session-1",
        ["http://localhost:3000"],
        makeRequest(),
      );

      expect(verifyAuthenticationResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          response,
          expectedChallenge: "auth-challenge",
          expectedRPID: "localhost",
          credential: {
            id: "cred-id",
            publicKey: Buffer.from([1, 2, 3]),
            counter: 1,
          },
        }),
      );
      expect(prisma.passkey.update).toHaveBeenCalledWith({
        where: { credentialId: "cred-id" },
        data: { counter: 2 },
      });
      expect(result).toEqual({ userId: "user-1" });
    });
  });

  describe("listPasskeysForUser", () => {
    it("returns passkeys ordered for profile management", async () => {
      const rows = [
        { id: "pk-1", createdAt: new Date("2026-01-01T12:00:00"), label: null },
      ];
      vi.mocked(prisma.passkey.findMany).mockResolvedValue(rows);

      const result = await listPasskeysForUser("user-1");

      expect(prisma.passkey.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        select: { id: true, createdAt: true, label: true },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(rows);
    });
  });

  describe("deletePasskeyForUser", () => {
    it("returns true when a passkey was deleted", async () => {
      vi.mocked(prisma.passkey.deleteMany).mockResolvedValue({ count: 1 });

      const result = await deletePasskeyForUser("user-1", "pk-1");

      expect(result).toBe(true);
      expect(prisma.passkey.deleteMany).toHaveBeenCalledWith({
        where: { id: "pk-1", userId: "user-1" },
      });
    });

    it("returns false when no passkey matched", async () => {
      vi.mocked(prisma.passkey.deleteMany).mockResolvedValue({ count: 0 });

      const result = await deletePasskeyForUser("user-1", "missing");

      expect(result).toBe(false);
    });
  });
});
