/**
 * Whether outbound email (Resend) is enabled for password reset and similar flows.
 * Explicit `ENABLE_EMAIL=false` disables; `true` forces on; when unset, auto-enables
 * when Resend + sender + APP_URL are configured.
 */
export function isOutboundEmailEnabled(): boolean {
  const flag = process.env.ENABLE_EMAIL?.trim().toLowerCase();
  if (flag === "false") return false;
  if (flag === "true") return true;
  return Boolean(
    process.env.RESEND_API_KEY &&
    process.env.EMAIL_FROM?.trim() &&
    process.env.APP_URL?.trim(),
  );
}

/** Resend sender, app base URL, and API key when outbound email is enabled. */
export function getOutboundEmailConfig(): {
  resendApiKey: string;
  fromEmail: string;
  appUrl: string;
} | null {
  if (!isOutboundEmailEnabled()) return null;
  const resendApiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const fromEmail = process.env.EMAIL_FROM?.trim() ?? "";
  const appUrl = process.env.APP_URL?.trim().replace(/\/$/, "") ?? "";
  if (!resendApiKey || !fromEmail || !appUrl) return null;
  return { resendApiKey, fromEmail, appUrl };
}
