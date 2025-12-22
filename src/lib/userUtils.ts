/**
 * Utility functions for user management
 */

/**
 * Check if a user is a placeholder/temporary user
 * Placeholder users have empty firstName/lastName and no email
 */
export function isPlaceholderUser(user: {
  firstName: string;
  lastName: string;
  email?: string | null;
}): boolean {
  const hasName = !!(
    (user.firstName || "").trim() || (user.lastName || "").trim()
  );
  const hasEmail = !!(user.email || "").trim();
  return !hasName && !hasEmail;
}
