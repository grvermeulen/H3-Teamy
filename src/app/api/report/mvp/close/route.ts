import { NextRequest, NextResponse } from "next/server";
import { isAdminUser } from "../../../../../lib/trainer";
import { getAttendanceRoster, getMvpState, saveMvpState, summarizeVotes } from "../../../../../lib/mvp";
import { getReport, setReport } from "../../../../../lib/kv";

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
  if (state.status === "closed") {
    const roster = await getAttendanceRoster();
    const summary = summarizeVotes(state, roster);
    return NextResponse.json({
      ok: true,
      status: state.status,
      winner: summary.breakdown[0] || null,
      totalVotes: summary.totalVotes,
      closedAt: state.closedAt || null,
    });
  }
  const roster = await getAttendanceRoster();
  const summary = summarizeVotes(state, roster);
  if (summary.totalVotes === 0) {
    return NextResponse.json({ error: "no_votes" }, { status: 400 });
  }
  const winner = summary.breakdown[0]!;
  const closedAt = new Date().toISOString();
  state.status = "closed";
  state.closedAt = closedAt;
  state.closedBy = adminInfo.me.id;
  await saveMvpState(eventId, state);

  const report = await getReport(eventId);
  const updatedReport = report
    ? { ...report, mvpResult: { name: winner.name, percent: winner.percent, votes: winner.votes, totalVotes: summary.totalVotes, decidedAt: closedAt } }
    : { content: "", createdAt: closedAt, mvpResult: { name: winner.name, percent: winner.percent, votes: winner.votes, totalVotes: summary.totalVotes, decidedAt: closedAt } };
  await setReport(eventId, updatedReport);

  return NextResponse.json({
    ok: true,
    status: state.status,
    winner,
    totalVotes: summary.totalVotes,
    closedAt,
  });
}

