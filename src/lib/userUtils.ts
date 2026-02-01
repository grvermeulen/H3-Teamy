export type UserIdentity = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export function hasUserIdentity(user: UserIdentity): boolean {
  const first = (user.firstName || "").trim();
  const last = (user.lastName || "").trim();
  const email = (user.email || "").trim();
  return Boolean(first || last || email);
}
