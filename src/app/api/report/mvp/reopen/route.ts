import { NextRequest, NextResponse } from "next/server";
import { isAdminUser } from "../../../../../lib/trainer";
import { getMvpState, saveMvpState } from "../../../../../lib/mvp";
import { getReport, setReport } from "../../../../../lib/kv";
import { reinstateMvpPlaceholder } from "../../../../../lib/mvpNarrative";

export async function POST(req: NextRequest) {
  const adminInfo = await isAdminUser(req);
  if (!adminInfo.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({} as any));
  const eventId = (body?.eventId as string | undefined)?.trim();
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }
  const state = await getMvpState(eventId);
  if (state.status !== "closed") {
    return NextResponse.json({ ok: true, status: state.status });
  }
  state.status = "open";
  delete state.closedAt;
  delete state.closedBy;
  await saveMvpState(eventId, state);

  const report = await getReport(eventId);
  if (report) {
    const nextReport = {
      ...report,
      content: reinstateMvpPlaceholder(report.content),
    };
    delete (nextReport as any).mvpResult;
    await setReport(eventId, nextReport);
  }

  return NextResponse.json({ ok: true, status: state.status });
}

