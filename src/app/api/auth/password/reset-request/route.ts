import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getOutboundEmailConfig } from "../../../../../lib/emailEnv";
import { createPasswordResetToken } from "../../../../../lib/kv";

export async function POST(req: NextRequest) {
  return Sentry.startSpan(
    { op: "http.server", name: "POST /api/auth/password/reset-request" },
    async (span) => {
      try {
        const { email } = await req.json().catch(() => ({ email: "" }));
        const normalizedEmail = String(email).trim().toLowerCase();
        span.setAttribute("email_present", Boolean(normalizedEmail));
        if (!normalizedEmail) return NextResponse.json({ ok: true });

        const { ok, token, recipientEmail, suppressed } =
          await createPasswordResetToken(normalizedEmail);
        span.setAttribute("password_reset_suppressed", Boolean(suppressed));
        const emailConfig = getOutboundEmailConfig();
        let sent = false;

        if (token && emailConfig) {
          try {
            const { Resend } = await import("resend");
            const resend = new Resend(emailConfig.resendApiKey);
            const url = `${emailConfig.appUrl}/reset/${encodeURIComponent(token)}`;
            const result = await resend.emails.send({
              from: emailConfig.fromEmail,
              to: recipientEmail ?? normalizedEmail,
              subject: "Wachtwoord resetten — H3 Teamy",
              html: `<p>Je hebt gevraagd om je wachtwoord te resetten voor H3 Teamy.</p><p><a href="${url}">Klik hier om een nieuw wachtwoord te kiezen</a></p><p>Of kopieer deze link: ${url}</p><p>De link is 60 minuten geldig.</p><p>Heb je dit niet aangevraagd? Negeer deze e-mail.</p>`,
            });
            if (result.error) {
              Sentry.captureException(
                new Error(result.error.message || "resend_send_failed"),
                {
                  tags: { context: "password_reset_email" },
                  extra: { resend: result.error },
                },
              );
            } else {
              sent = true;
            }
          } catch (error: unknown) {
            Sentry.captureException(error, {
              tags: { context: "password_reset_email" },
            });
          }
        } else if (token && !emailConfig) {
          Sentry.captureMessage("password_reset_email_not_configured", {
            level: "warning",
            tags: { context: "password_reset_email" },
            extra: {
              enableEmailFlag: process.env.ENABLE_EMAIL ?? null,
              hasResendKey: Boolean(process.env.RESEND_API_KEY),
              hasFrom: Boolean(process.env.EMAIL_FROM),
              hasAppUrl: Boolean(process.env.APP_URL),
            },
          });
        }

        span.setAttribute("password_reset_sent", sent);

        const body: {
          ok: boolean;
          token?: string;
          suppressed?: boolean;
          sent?: boolean;
        } = { ok };
        if (suppressed) body.suppressed = true;
        if (sent) body.sent = true;
        if (process.env.NODE_ENV !== "production") body.token = token;
        return NextResponse.json(body);
      } catch (error: unknown) {
        Sentry.captureException(error);
        return NextResponse.json({ ok: true });
      }
    },
  );
}
