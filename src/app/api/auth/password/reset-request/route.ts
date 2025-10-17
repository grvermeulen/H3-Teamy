import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createPasswordResetToken } from "../../../../../lib/kv";

export async function POST(req: NextRequest) {
  return Sentry.startSpan(
    { op: "http.server", name: "POST /api/auth/password/reset-request" },
    async (span) => {
      try {
        const { email } = await req.json().catch(() => ({ email: "" }));
        span.setAttribute("email_present", Boolean(email));
        if (!email) return NextResponse.json({ ok: true });

        const { ok, token } = await createPasswordResetToken(
          String(email).toLowerCase(),
        );
        const enableEmail = process.env.ENABLE_EMAIL === "true";
        const appUrl = process.env.APP_URL || "";
        const fromEmail = process.env.EMAIL_FROM || "";

        if (enableEmail && process.env.RESEND_API_KEY && appUrl && fromEmail) {
          try {
            const { Resend } = await import("resend");
            const resend = new Resend(process.env.RESEND_API_KEY);
            if (token) {
              const url = `${appUrl.replace(/\/$/, "")}/reset/${encodeURIComponent(token)}`;
              await resend.emails.send({
                from: fromEmail,
                to: email,
                subject: "Reset your password",
                html: `<p>Click the link below to reset your password:</p><p><a href="${url}">${url}</a></p><p>This link expires in 15 minutes.</p>`,
              });
            }
          } catch (e) {
            Sentry.captureException(e);
          }
        }

        // In dev, return token to make testing simple
        const body: any = { ok };
        if (process.env.NODE_ENV !== "production") body.token = token;
        return NextResponse.json(body);
      } catch (error) {
        Sentry.captureException(error as any);
        return NextResponse.json({ ok: true }); // generic success to avoid enumeration
      }
    },
  );
}
