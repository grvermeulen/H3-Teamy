import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { redeemPasswordResetToken } from "../../../../../lib/kv";

export async function POST(req: NextRequest) {
  return Sentry.startSpan(
    { op: "http.server", name: "POST /api/auth/password/reset-confirm" },
    async () => {
      try {
        const { token, newPassword } = await req
          .json()
          .catch(() => ({ token: "", newPassword: "" }));
        const res = await redeemPasswordResetToken(token, newPassword);
        if (!res.ok)
          return NextResponse.json(
            { error: res.error || "invalid" },
            { status: 400 },
          );
        return NextResponse.json({ ok: true });
      } catch (error) {
        Sentry.captureException(error as any);
        return NextResponse.json({ error: "failed" }, { status: 500 });
      }
    },
  );
}
