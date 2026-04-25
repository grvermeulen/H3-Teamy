import { prisma } from "./db";

/**
 * Maakt een nieuwe cookie-`providerUserId` (UUID) en koppelt die aan de gegeven gebruiker,
 * zodat `anon_id` altijd overeenkomt met een `Identity`-rij voor `provider: "cookie"`.
 *
 * @param userId - Bestaande gebruiker na succesvolle link-koppeling.
 * @returns Waarde voor de `anon_id`-cookie (UUID).
 */
export async function mintCookieAnonIdForUser(userId: string): Promise<string> {
  const providerUserId = crypto.randomUUID();
  await prisma.identity.upsert({
    where: {
      provider_providerUserId: {
        provider: "cookie",
        providerUserId,
      },
    },
    create: { provider: "cookie", providerUserId, userId },
    update: { userId },
  });
  return providerUserId;
}
