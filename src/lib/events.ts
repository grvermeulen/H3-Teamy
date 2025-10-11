import { prisma } from "./db";
import { fetchTeamEvents } from "./ical";

type UpsertResult = { created: number; updated: number };

export async function syncEventsFromIcal(): Promise<UpsertResult> {
  const events = await fetchTeamEvents();
  let created = 0;
  let updated = 0;

  for (const evt of events) {
    const id = evt.id; // canonical ID
    const uid = evt.uid || null;

    if (uid) {
      const existingByUid = await prisma.event.findUnique({ where: { uid } });
      if (existingByUid) {
        await prisma.event.update({
          where: { uid },
          data: {
            // keep stable primary key; only update the fields
            title: evt.title,
            start: new Date(evt.start),
            end: evt.end ? new Date(evt.end) : null,
            location: evt.location || null,
            description: evt.description || null,
            canonicalId: id,
          },
        });
        updated++;
        continue;
      }
    }

    // Upsert on primary key (canonical id) when UID is missing or not found
    const res = await prisma.event.upsert({
      where: { id },
      create: {
        id,
        uid,
        canonicalId: id,
        title: evt.title,
        start: new Date(evt.start),
        end: evt.end ? new Date(evt.end) : null,
        location: evt.location || null,
        description: evt.description || null,
      },
      update: {
        uid,
        title: evt.title,
        start: new Date(evt.start),
        end: evt.end ? new Date(evt.end) : null,
        location: evt.location || null,
        description: evt.description || null,
      },
    });
    if (res.createdAt.getTime() === res.updatedAt.getTime()) created++;
    else updated++;
  }

  return { created, updated };
}

export async function getSeasonEvents(includePast: boolean): Promise<Array<{
  id: string;
  uid?: string | null;
  title: string;
  start: string;
  end?: string | null;
  location?: string | null;
  description?: string | null;
}>> {
  const now = new Date();
  const where = includePast ? {} : { start: { gte: now } };
  const rows = await prisma.event.findMany({ where, orderBy: { start: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    uid: r.uid,
    title: r.title,
    start: r.start.toISOString(),
    end: r.end ? r.end.toISOString() : null,
    location: r.location,
    description: r.description,
  }));
}


