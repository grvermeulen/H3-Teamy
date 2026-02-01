export type UserIdentity = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export function displayName(user: UserIdentity): string {
  const full =
    `${(user.firstName || "").trim()} ${(user.lastName || "").trim()}`.trim();
  if (full) return full;
  const email = (user.email || "").trim();
  if (email) return email;
  return "";
}

export function hasUserIdentity(user: UserIdentity): boolean {
  const first = (user.firstName || "").trim();
  const last = (user.lastName || "").trim();
  const email = (user.email || "").trim();
  return Boolean(first || last || email);
}
