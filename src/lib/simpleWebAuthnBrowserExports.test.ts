import { describe, expect, it } from "vitest";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser";

describe("@simplewebauthn/browser v14 exports", () => {
  it("exposes the passkey client APIs used by login and profile", () => {
    expect(typeof browserSupportsWebAuthn).toBe("function");
    expect(typeof startAuthentication).toBe("function");
    expect(typeof startRegistration).toBe("function");
  });

  it("keeps the JSON option/response types used by API routes", () => {
    const loginOptions: PublicKeyCredentialRequestOptionsJSON = {
      challenge: "challenge",
      timeout: 60000,
    };
    const registerOptions: PublicKeyCredentialCreationOptionsJSON = {
      challenge: "challenge",
      rp: { name: "H3 Teamy", id: "localhost" },
      user: { id: "user", name: "user@example.test", displayName: "User" },
      pubKeyCredParams: [],
    };
    const authResponse: AuthenticationResponseJSON = {
      id: "cred",
      rawId: "cred",
      type: "public-key",
      response: {
        clientDataJSON: "client",
        authenticatorData: "auth",
        signature: "sig",
      },
      clientExtensionResults: {},
    };
    const registerResponse: RegistrationResponseJSON = {
      id: "cred",
      rawId: "cred",
      type: "public-key",
      response: {
        clientDataJSON: "client",
        attestationObject: "attest",
      },
      clientExtensionResults: {},
    };

    expect(loginOptions.challenge).toBe("challenge");
    expect(registerOptions.rp.id).toBe("localhost");
    expect(authResponse.id).toBe("cred");
    expect(registerResponse.response.attestationObject).toBe("attest");
  });
});
