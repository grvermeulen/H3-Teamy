import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getActiveUser } from "../activeUser";
import { isTrainer } from "../trainer";

/** Outcome of a guard: the caller's identity, or the error response to return. */
export type GuardResult<T> =
  { ok: true; value: T } | { ok: false; response: NextResponse };

/** Rejects non-trainers with 403. */
export async function requireTrainer(
  req: NextRequest,
): Promise<GuardResult<{ id: string; name: string }>> {
  const { isTrainer: ok, me } = await isTrainer(req);
  if (!ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Alleen voor trainers" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, value: me };
}

/** Rejects guests who still have to link an account with 401. */
export async function requireLinkedUser(
  req: NextRequest,
): Promise<GuardResult<{ userId: string }>> {
  const { userId, needsLink } = await getActiveUser(req);
  if (needsLink) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Log eerst in om dit te doen" },
        { status: 401 },
      ),
    };
  }
  return { ok: true, value: { userId } };
}

/** Reads JSON from a request, returning `null` for a missing or invalid body. */
export async function readJson(req: NextRequest): Promise<unknown> {
  return req.json().catch(() => null);
}

/** Standard 400 for a failed Zod parse. */
export function invalidInput(issues: unknown): NextResponse {
  return NextResponse.json(
    { error: "Ongeldige invoer", issues },
    { status: 400 },
  );
}

/** Reports to Sentry and returns a generic 500. */
export function serverError(err: unknown, component: string): NextResponse {
  Sentry.captureException(err, { tags: { component } });
  return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
}
