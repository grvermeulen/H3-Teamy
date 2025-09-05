/*
  One-off script to remove RSVPs for users with IDs starting with given prefixes
  for the first upcoming match (based on SPORTLINK_ICAL_URL).

  Usage:
    set -a && source .env.local 2>/dev/null || true && set +a; node scripts/remove-rsvps.js
*/

const { PrismaClient } = require('@prisma/client');
const ical = require('node-ical');

function pad2(n) { return n < 10 ? `0${n}` : String(n); }
function slugifyTitle(title) {
  return (title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
function canonicalEventId(title, start) {
  const d = start instanceof Date ? start : new Date(start);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const slug = slugifyTitle(title);
  return `${y}${m}${day}--${slug}`;
}

async function fetchTeamEvents() {
  const url = process.env.SPORTLINK_ICAL_URL;
  if (!url) throw new Error('SPORTLINK_ICAL_URL is not set');
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch iCal: ${res.status}`);
  const text = await res.text();
  const data = ical.parseICS(text);
  const events = Object.values(data)
    .filter((c) => c && c.type === 'VEVENT')
    .map((evt) => {
      const title = (evt.summary || 'Match').toString();
      const startIso = evt.start instanceof Date ? evt.start.toISOString() : new Date(evt.start).toISOString();
      return {
        id: canonicalEventId(title, startIso),
        title,
        start: startIso,
      };
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return events;
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const userPrefixes = ['cmesob', 'cmesmf'];

  console.log('Loading events...');
  const events = await fetchTeamEvents();
  const now = Date.now();
  const firstUpcoming = events.find((e) => new Date(e.start).getTime() >= now) || events[0];
  if (!firstUpcoming) throw new Error('No events found');
  const eventId = firstUpcoming.id;
  console.log('First match:', { id: eventId, title: firstUpcoming.title, start: firstUpcoming.start });

  let totalDeleted = 0;
  for (const prefix of userPrefixes) {
    const users = await prisma.user.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
    if (users.length === 0) {
      console.log(`No users found for prefix ${prefix}`);
      continue;
    }
    for (const { id: userId } of users) {
      const { count } = await prisma.rsvp.deleteMany({ where: { userId, eventId } });
      totalDeleted += count;
      console.log(`Deleted ${count} RSVP(s) for user ${userId} on event ${eventId}`);
    }
  }
  console.log('Done. Total RSVPs deleted:', totalDeleted);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });


