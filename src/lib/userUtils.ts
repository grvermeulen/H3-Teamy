export type UserIdentity = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

/**
 * Constructs a display name for a user.
 * Prioritizes "First Last", then "Email", then empty string.
 *
 * @param user - The user object containing identity fields.
 * @returns The formatted display name.
 */
export function displayName(user: UserIdentity): string {
  const full =
    `${(user.firstName || "").trim()} ${(user.lastName || "").trim()}`.trim();
  if (full) return full;
  const email = (user.email || "").trim();
  if (email) return email;
  return "";
}

/**
 * Checks if a user has enough identity information to be displayed.
 *
 * @param user - The user object.
 * @returns True if the user has a first name, last name, or email.
 */
export function hasUserIdentity(user: UserIdentity): boolean {
  const first = (user.firstName || "").trim();
  const last = (user.lastName || "").trim();
  const email = (user.email || "").trim();
  return Boolean(first || last || email);
}
