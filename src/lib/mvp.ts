import { kvGetJson, kvSetJson, getAttendanceForDates } from "./kv";
import { prisma } from "./db";
import { defaultSeasonWindow, generateTrainingDates } from "./training";

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
const ROSTER_CACHE_KEY = "mvp:roster:v1";
const ROSTER_TTL_MS = 15 * 60 * 1000;

type CachedRoster = { fetchedAt: string; list: RosterEntry[] };

function displayName(user: {
  firstName: string;
  lastName: string;
  email?: string | null;
  id: string;
}): string {
  const full =
    `${(user.firstName || "").trim()} ${(user.lastName || "").trim()}`.trim();
  if (full) return full;
  const email = (user.email || "").trim();
  if (email) return email;
  return `Speler ${user.id.slice(0, 6)}`;
}

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
    const fallback = await prisma.user
      .findMany({
        select: { id: true, firstName: true, lastName: true, email: true },
      })
      .catch(() => [] as any[]);
    return fallback
      .map((u: any) => ({ id: u.id, name: displayName(u) }))
      .filter((r) => r.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const users = await prisma.user
    .findMany({
      where: { id: { in: rosterIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
    .catch(() => [] as any[]);
  const list = users.map((u: any) => ({ id: u.id, name: displayName(u) }));
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
  for (const entry of roster) {
    nameMap.set(entry.id, entry.name);
  }
  const counts = new Map<
    string,
    { candidateId: string; name: string; votes: number }
  >();
  for (const vote of state.votes) {
    const name =
      nameMap.get(vote.candidateId) ||
      vote.candidateName ||
      `Speler ${vote.candidateId.slice(0, 6)}`;
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
