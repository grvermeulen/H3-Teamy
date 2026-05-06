import type {
  AuthenticatorTransportFuture,
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";
import { randomBytes } from "crypto";
import { prisma } from "../db";
import { webAuthnConsumeChallenge, webAuthnStoreChallenge } from "../kv";
import { getWebAuthnRpConfig } from "../webAuthnEnv";

/**
 * Start WebAuthn-registratie voor een ingelogde gebruiker; slaat de challenge op onder `userId`.
 *
 * @param userId - Actieve gebruiker (sessie).
 * @throws Error `user_not_found` als de gebruiker niet bestaat.
 */
export async function startPasskeyRegistration(userId: string): Promise<{
  optionsJSON: Awaited<ReturnType<typeof generateRegistrationOptions>>;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (!user) {
    throw new Error("user_not_found");
  }

  const existing = await prisma.passkey.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });

  const { rpID, rpName } = getWebAuthnRpConfig();
  const userName = user.email ?? user.id;
  const userDisplayName =
    `${user.firstName} ${user.lastName}`.trim() || userName;

  const excludeCredentials = existing.map((row) => {
    let transports: AuthenticatorTransportFuture[] | undefined;
    if (row.transports) {
      try {
        transports = JSON.parse(row.transports) as AuthenticatorTransportFuture[];
      } catch {
        transports = undefined;
      }
    }
    return {
      id: row.credentialId,
      ...(transports ? { transports } : {}),
    };
  });

  const userID = isoUint8Array.fromUTF8String(user.id);
  if (userID.byteLength > 64) {
    throw new Error("user_id_too_long");
  }

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName,
    userDisplayName,
    userID,
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await webAuthnStoreChallenge("registration", userId, options.challenge);

  return { optionsJSON: options };
}

/**
 * Voltooit registratie en slaat de publieke sleutel op.
 *
 * @param userId - Dezelfde gebruiker als bij {@link startPasskeyRegistration}.
 * @param response - Ruwe browser-response (`startRegistration`).
 * @param expectedOrigins - Toegestane origins voor clientDataJSON (zie {@link ../webAuthnEnv.getWebAuthnAllowedOrigins}).
 */
export async function finishPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  expectedOrigins: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const expectedChallenge = await webAuthnConsumeChallenge(
    "registration",
    userId,
  );
  if (!expectedChallenge) {
    return { ok: false, error: "challenge_missing" };
  }

  const { rpID } = getWebAuthnRpConfig();

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch {
    return { ok: false, error: "verification_failed" };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: "verification_failed" };
  }

  const { credential } = verification.registrationInfo;
  const transportsJson =
    credential.transports && credential.transports.length > 0
      ? JSON.stringify(credential.transports)
      : null;

  try {
    await prisma.passkey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: transportsJson,
      },
    });
  } catch {
    return { ok: false, error: "duplicate_or_db" };
  }

  return { ok: true };
}

/**
 * Start passkey-login (discoverable credentials); retourneert een aparte `loginSessionId` voor challenge-lookup.
 */
export async function startPasskeyLogin(): Promise<{
  optionsJSON: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  loginSessionId: string;
}> {
  const { rpID } = getWebAuthnRpConfig();
  const loginSessionId = randomBytes(24).toString("base64url");
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    timeout: 60000,
  });

  await webAuthnStoreChallenge(
    "authentication",
    loginSessionId,
    options.challenge,
  );

  return { optionsJSON: options, loginSessionId };
}

/**
 * Verifieert een login-response en werkt de teller bij.
 *
 * @param response - Ruwe browser-response (`startAuthentication`).
 * @param loginSessionId - Id uit {@link startPasskeyLogin}.
 * @param expectedOrigins - Zie {@link finishPasskeyRegistration}.
 */
export async function finishPasskeyLogin(
  response: AuthenticationResponseJSON,
  loginSessionId: string,
  expectedOrigins: string[],
): Promise<{ userId: string } | { error: string }> {
  const expectedChallenge = await webAuthnConsumeChallenge(
    "authentication",
    loginSessionId,
  );
  if (!expectedChallenge) {
    return { error: "challenge_missing" };
  }

  const credentialId = response.id;
  const passkey = await prisma.passkey.findUnique({
    where: { credentialId },
    select: {
      userId: true,
      credentialId: true,
      publicKey: true,
      counter: true,
    },
  });
  if (!passkey) {
    return { error: "credential_unknown" };
  }

  const { rpID } = getWebAuthnRpConfig();

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey),
        counter: passkey.counter,
      },
      requireUserVerification: false,
    });
  } catch {
    return { error: "verification_failed" };
  }

  if (!verification.verified) {
    return { error: "verification_failed" };
  }

  const newCounter = verification.authenticationInfo.newCounter;
  await prisma.passkey.update({
    where: { credentialId: passkey.credentialId },
    data: { counter: newCounter },
  });

  return { userId: passkey.userId };
}

export type PasskeyListItem = {
  id: string;
  createdAt: Date;
  label: string | null;
};

/**
 * Lijst passkeys voor profielbeheer (geen gevoelige velden).
 *
 * @param userId - Gebruiker waarvan passkeys worden opgevraagd.
 */
export async function listPasskeysForUser(
  userId: string,
): Promise<PasskeyListItem[]> {
  return prisma.passkey.findMany({
    where: { userId },
    select: { id: true, createdAt: true, label: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Verwijdert een passkey als die aan `userId` toebehoort.
 *
 * @returns `true` als er een rij is verwijderd.
 */
export async function deletePasskeyForUser(
  userId: string,
  passkeyId: string,
): Promise<boolean> {
  const res = await prisma.passkey.deleteMany({
    where: { id: passkeyId, userId },
  });
  return res.count > 0;
}
