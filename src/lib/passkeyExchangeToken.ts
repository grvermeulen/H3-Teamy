import { createHmac, timingSafeEqual } from "crypto";

const TTL_MS = 90_000;

/**
 * Maakt een kortlevend HMAC-token om na geslaagde WebAuthn-login een NextAuth credentials-sessie te starten.
 *
 * @param userId - Interne gebruikers-id (Prisma `User.id`).
 * @returns Getekende base64url-string; leeg secret → lege string (alleen test/misconfig).
 */
export function createPasskeyExchangeToken(userId: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? "";
  if (!secret) return "";
  const exp = Date.now() + TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest();
  return `${payload}.${sig.toString("base64url")}`;
}

/**
 * Valideert {@link createPasskeyExchangeToken} en retourneert het user-id bij geldige handtekening en expiry.
 *
 * @param token - Ruwe token van de login-verify-route.
 * @returns `userId` of `null` bij ongeldige/expired token.
 */
export function verifyPasskeyExchangeToken(token: string): string | null {
  const secret = process.env.NEXTAUTH_SECRET ?? "";
  if (!secret || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  const expectedSig = createHmac("sha256", secret).update(payload).digest();
  if (sigBuf.length !== expectedSig.length) return null;
  if (!timingSafeEqual(sigBuf, expectedSig)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const uid = (parsed as { uid?: unknown }).uid;
  const exp = (parsed as { exp?: unknown }).exp;
  if (typeof uid !== "string" || typeof exp !== "number") return null;
  if (Date.now() > exp) return null;
  return uid;
}
