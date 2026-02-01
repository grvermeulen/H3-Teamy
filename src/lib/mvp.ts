import * as Sentry from "@sentry/nextjs";
import { kvGetJson, kvSetJson, getAttendanceForDates } from "./kv";
import { prisma } from "./db";
import { defaultSeasonWindow, generateTrainingDates } from "./training";
import { displayName, hasUserIdentity } from "./userUtils";

export type RosterEntry = { id: string; name: string };
export type MvpVoteRecord = {
  voterId: string;
  candidateId: string;
  candidateName: string;
  createdAt: string;
};
export type MvpVotingState = {
  eventId: string;
  status: "open" | "closed";
  votes: MvpVoteRecord[];
  createdAt: string;
  closedAt?: string;
  closedBy?: string;
};

const MVP_STATE_KEY = (eventId: string) => `mvp:${eventId}`;
const ROSTER_CACHE_KEY = "mvp:roster:v2";
const ROSTER_TTL_MS = 15 * 60 * 1000;

type CachedRoster = { fetchedAt: string; list: RosterEntry[] };
type UserRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

async function buildRosterFromAttendance(): Promise<RosterEntry[]> {
  const { from, to } = defaultSeasonWindow();
  const dates = generateTrainingDates(new Date(from), new Date(to));
  if (dates.length === 0) return [];
  const attendance = await getAttendanceForDates(dates);
  const ids = new Set<string>();
  for (const list of Object.values(attendance)) {
    for (const userId of list) {
      if (userId) ids.add(userId);
    }
  }
  const rosterIds = Array.from(ids);
  if (!rosterIds.length) {
    let fallback: UserRow[] = [];
    try {
      fallback = await prisma.user.findMany({
        select: { id: true, firstName: true, lastName: true, email: true },
      });
    } catch (error: unknown) {
      Sentry.captureException(error);
      return [];
    }
    return fallback
      .map((u) => ({ id: u.id, name: displayName(u) }))
      .filter((r) => r.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  let users: UserRow[] = [];
  try {
    users = await prisma.user.findMany({
      where: { id: { in: rosterIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  } catch (error: unknown) {
    Sentry.captureException(error);
    return [];
  }
  const list = users
    .filter((u) => hasUserIdentity(u))
    .map((u) => ({ id: u.id, name: displayName(u) }))
    .filter((entry) => entry.name);
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

export async function getAttendanceRoster(
  forceRefresh = false,
): Promise<RosterEntry[]> {
  if (!forceRefresh) {
    const cached = await kvGetJson<CachedRoster>(ROSTER_CACHE_KEY);
    if (cached?.list) {
      const age = Date.now() - new Date(cached.fetchedAt || 0).getTime();
      if (age < ROSTER_TTL_MS) {
        return cached.list;
      }
    }
  }
  const list = await buildRosterFromAttendance();
  await kvSetJson(ROSTER_CACHE_KEY, {
    fetchedAt: new Date().toISOString(),
    list,
  });
  return list;
}

export async function getMvpState(eventId: string): Promise<MvpVotingState> {
  const existing = await kvGetJson<MvpVotingState>(MVP_STATE_KEY(eventId));
  if (existing && Array.isArray(existing.votes)) {
    return existing;
  }
  const fresh: MvpVotingState = {
    eventId,
    status: "open",
    votes: [],
    createdAt: new Date().toISOString(),
  };
  await kvSetJson(MVP_STATE_KEY(eventId), fresh);
  return fresh;
}

export async function saveMvpState(
  eventId: string,
  state: MvpVotingState,
): Promise<void> {
  await kvSetJson(MVP_STATE_KEY(eventId), state);
}

export type VoteBreakdown = {
  candidateId: string;
  name: string;
  votes: number;
  percent: number;
};

export function summarizeVotes(
  state: MvpVotingState,
  roster: RosterEntry[],
): { totalVotes: number; breakdown: VoteBreakdown[] } {
  const totalVotes = state.votes.length;
  const nameMap = new Map<string, string>();
  const rosterIds = new Set<string>();
  for (const entry of roster) {
    nameMap.set(entry.id, entry.name);
    rosterIds.add(entry.id);
  }
  const counts = new Map<
    string,
    { candidateId: string; name: string; votes: number }
  >();
  for (const vote of state.votes) {
    if (!rosterIds.has(vote.candidateId)) continue;
    const name = nameMap.get(vote.candidateId) || vote.candidateName || "";
    if (!name) continue;
    const current = counts.get(vote.candidateId) || {
      candidateId: vote.candidateId,
      name,
      votes: 0,
    };
    current.votes += 1;
    current.name = name; // ensure updated if roster name changed
    counts.set(vote.candidateId, current);
  }
  const breakdown = Array.from(counts.values()).map((item) => ({
    candidateId: item.candidateId,
    name: item.name,
    votes: item.votes,
    percent: totalVotes ? Math.round((item.votes / totalVotes) * 100) : 0,
  }));
  breakdown.sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return a.name.localeCompare(b.name);
  });
  return { totalVotes, breakdown };
}
