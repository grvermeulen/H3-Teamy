import { NextRequest, NextResponse } from "next/server";
import { isAdminUser } from "../../../../lib/trainer";
import {
  getAttendanceRoster,
  getMvpState,
  saveMvpState,
  summarizeVotes,
  RosterEntry,
  VoteBreakdown,
} from "../../../../lib/mvp";

type Payload = {
  eventId: string;
  status: "open" | "closed";
  roster: RosterEntry[];
  totalVotes: number;
  breakdown: VoteBreakdown[];
  hasVoted: boolean;
  votedFor: { id: string; name: string } | null;
  winner: VoteBreakdown | null;
  canClose: boolean;
  canReopen: boolean;
  closedAt: string | null;
};

function buildPayload(params: {
  eventId: string;
  state: Awaited<ReturnType<typeof getMvpState>>;
  roster: RosterEntry[];
  userId: string;
  isAdmin: boolean;
}): Payload {
  const { eventId, state, roster, userId, isAdmin } = params;
  const summary = summarizeVotes(state, roster);
  const myVote = state.votes.find((v) => v.voterId === userId) || null;
  const winner =
    state.status === "closed" ? summary.breakdown[0] || null : null;
  return {
    eventId,
    status: state.status,
    roster,
    totalVotes: summary.totalVotes,
    breakdown: summary.breakdown,
    hasVoted: Boolean(myVote),
    votedFor: myVote
      ? { id: myVote.candidateId, name: myVote.candidateName }
      : null,
    winner,
    canClose: Boolean(
      isAdmin && state.status === "open" && summary.totalVotes > 0,
    ),
    canReopen: Boolean(isAdmin && state.status === "closed"),
    closedAt: state.closedAt || null,
  };
}

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId")?.trim();
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }
  const adminInfo = await isAdminUser(req);
  const roster = await getAttendanceRoster();
  const state = await getMvpState(eventId);
  const payload = buildPayload({
    eventId,
    state,
    roster,
    userId: adminInfo.me.id,
    isAdmin: adminInfo.isAdmin,
  });
  return NextResponse.json(payload);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as any);
  const eventId = (body?.eventId as string | undefined)?.trim();
  const candidateId = (body?.candidateId as string | undefined)?.trim();
  if (!eventId || !candidateId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const adminInfo = await isAdminUser(req);
  const roster = await getAttendanceRoster();
  if (!roster.some((entry) => entry.id === candidateId)) {
    return NextResponse.json({ error: "invalid_candidate" }, { status: 400 });
  }
  const state = await getMvpState(eventId);
  if (state.status !== "open") {
    return NextResponse.json({ error: "voting_closed" }, { status: 409 });
  }
  if (state.votes.some((vote) => vote.voterId === adminInfo.me.id)) {
    return NextResponse.json({ error: "already_voted" }, { status: 409 });
  }
  const candidate = roster.find((entry) => entry.id === candidateId)!;
  state.votes.push({
    voterId: adminInfo.me.id,
    candidateId,
    candidateName: candidate.name,
    createdAt: new Date().toISOString(),
  });
  await saveMvpState(eventId, state);
  const payload = buildPayload({
    eventId,
    state,
    roster,
    userId: adminInfo.me.id,
    isAdmin: adminInfo.isAdmin,
  });
  return NextResponse.json(payload);
}
