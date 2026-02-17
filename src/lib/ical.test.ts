import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchTeamEvents } from "./ical";
import { kvGetJson, kvSetJson } from "./kv";

// Mock dependencies
vi.mock("./kv", () => ({
  kvGetJson: vi.fn(),
  kvSetJson: vi.fn().mockReturnValue(Promise.resolve()),
}));

const now = new Date();
const futureDate = new Date(now.getTime() + 1000 * 60 * 60 * 24); // Tomorrow
const isoFuture =
  futureDate.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
const isoEnd =
  new Date(futureDate.getTime() + 1000 * 60 * 60)
    .toISOString()
    .replace(/[-:]/g, "")
    .split(".")[0] + "Z";

const mockICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Sportlink//NONSGML//NL
BEGIN:VEVENT
UID:12345
DTSTART:${isoFuture}
DTEND:${isoEnd}
SUMMARY:Match 1
LOCATION:Pool A
END:VEVENT
END:VCALENDAR`;

describe("fetchTeamEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SPORTLINK_ICAL_URL = "http://example.com/calendar.ics";

    // Mock fetch
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(mockICS),
      } as Response),
    );
  });

  it("fetches and parses ical data", async () => {
    (kvGetJson as any).mockResolvedValue([]);

    const events = await fetchTeamEvents();

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Match 1");
    expect(events[0].location).toBe("Pool A");
    expect(kvSetJson).toHaveBeenCalled();
  });

  it("falls back to cache if fetch fails", async () => {
    // Mock fetch failure
    global.fetch = vi.fn(() => Promise.reject("Network error"));

    // Mock cache hit
    (kvGetJson as any).mockResolvedValue([
      {
        id: "cached-1",
        title: "Cached Match",
        start: new Date().toISOString(),
      },
    ]);

    const events = await fetchTeamEvents();

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Cached Match");
    // Should NOT update cache if fetch failed
    expect(kvSetJson).not.toHaveBeenCalled();
  });

  it("merges new data with cache", async () => {
    const pastDate = new Date(Date.now() - 100000).toISOString();
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(); // Tomorrow (same as mockICS)

    // Need to match the ID generation logic: YYYYMMDD--slug
    const d = new Date(futureDate);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const id = `${y}${m}${day}--match-1`;

    // Cache has one old event and one that will be updated
    (kvGetJson as any).mockResolvedValue([
      { id: "old-1", title: "Old Match", start: pastDate },
      { id: id, title: "Match 1 (Old)", start: futureDate }, // ID matches the one from mockICS
    ]);

    const events = await fetchTeamEvents();

    // Should have 2 events: Old Match (preserved) and Match 1 (updated from ICS)
    expect(events).toHaveLength(2);

    const updatedMatch = events.find((e) => e.title === "Match 1");
    expect(updatedMatch).toBeDefined();

    // Verify sorting (oldest first)
    expect(events[0].title).toBe("Old Match");
  });
});
