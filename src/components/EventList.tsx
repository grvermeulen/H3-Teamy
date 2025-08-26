"use client";

import { useEffect, useMemo, useState } from "react";
import type { TeamEvent, RsvpStatus } from "../types";

type Props = { events: TeamEvent[] };

type RsvpMap = Record<string, RsvpStatus>;

export default function EventList({ events }: Props) {
  const [rsvpMap, setRsvpMap] = useState<RsvpMap>({});
  const [counts, setCounts] = useState<Record<string, { yes: number; no: number; maybe: number }>>({});
  const [lists, setLists] = useState<Record<string, { yes: { id: string; name: string }[]; no: { id: string; name: string }[]; maybe: { id: string; name: string }[] }>>({});
  const [loadedLists, setLoadedLists] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function loadAll() {
    setIsRefreshing(true);
    const rsvpEntries = await Promise.all(
      events.map(async (e) => {
        const res = await fetch(`/api/rsvp?eventId=${encodeURIComponent(e.id)}`, { cache: "no-store" });
        if (!res.ok) return [e.id, null] as const;
        const data = await res.json();
        return [e.id, (data?.status ?? null) as RsvpStatus] as const;
      })
    );
    const countsEntries = await Promise.all(
      events.map(async (e) => {
        const res = await fetch(`/api/rsvp/list?eventId=${encodeURIComponent(e.id)}&countsOnly=1`, { cache: "no-store" });
        if (!res.ok) return [e.id, { yes: 0, no: 0, maybe: 0 }, { yes: [], no: [], maybe: [] }] as const;
        const data = await res.json();
        return [e.id, data.counts as { yes: number; no: number; maybe: number }, data.lists as any] as const;
      })
    );
    const map: RsvpMap = {};
    const cMap: Record<string, { yes: number; no: number; maybe: number }> = {};
    const lMap: Record<string, { yes: { id: string; name: string }[]; no: { id: string; name: string }[]; maybe: { id: string; name: string }[] }> = {};
    for (const [id, status] of rsvpEntries) map[id] = status;
    for (const [id, c, l] of countsEntries) { cMap[id] = c; lMap[id] = l; }
    setRsvpMap(map);
    setCounts(cMap);
    setLists(lMap);
    setIsRefreshing(false);
  }

  useEffect(() => {
    void loadAll();
  }, [events]);

  useEffect(() => {
    function onFocus() {
      void loadAll();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [events]);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function setRsvp(id: string, status: RsvpStatus) {
    setRsvpMap((prev) => ({ ...prev, [id]: status }));
    await fetch(`/api/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: id, status }),
    });
    // Refresh counts/lists for this event
    const res = await fetch(`/api/rsvp/list?eventId=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setCounts((prev) => ({ ...prev, [id]: data.counts }));
      setLists((prev) => ({ ...prev, [id]: data.lists }));
      setLoadedLists((prev) => ({ ...prev, [id]: true }));
    }
  }

  async function ensureListsLoaded(id: string) {
    if (loadedLists[id]) return;
    const res = await fetch(`/api/rsvp/list?eventId=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setCounts((prev) => ({ ...prev, [id]: data.counts }));
      setLists((prev) => ({ ...prev, [id]: data.lists }));
      setLoadedLists((prev) => ({ ...prev, [id]: true }));
    }
  }

  const grouped = useMemo(() => {
    const now = Date.now();
    const upcoming = events.filter((e) => new Date(e.start).getTime() >= now);
    return upcoming;
  }, [events]);

  return (
    <div className="list">
      <div className="row" style={{ marginBottom: 12, alignItems: "center", gap: 8 }}>
        <button onClick={() => void loadAll()} disabled={isRefreshing}>{isRefreshing ? "Refreshing…" : "Refresh"}</button>
        <span className="muted">Pull to refresh: focus page or press Refresh</span>
      </div>
      {grouped.map((evt) => {
        const start = new Date(evt.start);
        const end = evt.end ? new Date(evt.end) : undefined;
        const status = rsvpMap[evt.id] || null;
        return (
          <div className="card" key={evt.id}>
            <div className="row">
              <div className="grow">
                <div className="eventTitle">{evt.title}</div>
                <div className="eventMeta muted">
                  <span className="badge badge-date" suppressHydrationWarning>
                    {mounted ? start.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" }) : ""}
                  </span>
                  <span className="badge badge-time" suppressHydrationWarning>
                    {mounted ? `${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${end ? ` – ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}` : ""}
                  </span>
                  {evt.location ? <span className="badge">{evt.location}</span> : null}
                  {counts[evt.id] ? (
                    <span className="badge">Yes {counts[evt.id].yes} · Maybe {counts[evt.id].maybe} · No {counts[evt.id].no}</span>
                  ) : null}
                </div>
              </div>
              <div className="rsvp">
                <button
                  className={status === "yes" ? "active-yes" : ""}
                  onClick={() => setRsvp(evt.id, status === "yes" ? null : "yes")}
                >Yes</button>
                <button
                  className={status === "maybe" ? "active-maybe" : ""}
                  onClick={() => setRsvp(evt.id, status === "maybe" ? null : "maybe")}
                >Maybe</button>
                <button
                  className={status === "no" ? "active-no" : ""}
                  onClick={() => setRsvp(evt.id, status === "no" ? null : "no")}
                >No</button>
              </div>
            </div>
            {evt.description ? (
              <div className="muted" style={{ marginTop: 8 }}>{evt.description}</div>
            ) : null}
            <details style={{ marginTop: 10 }} onToggle={(e) => {
              const el = e.currentTarget as HTMLDetailsElement;
              if (el.open) void ensureListsLoaded(evt.id);
            }}>
              <summary className="muted">Show RSVP list</summary>
              <div className="row" style={{ gap: 16, marginTop: 8 }}>
                <div>
                  <div className="badge">Yes</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {(lists[evt.id]?.yes || []).map((u) => (<div key={u.id}>{u.name}</div>))}
                    {(lists[evt.id]?.yes || []).length === 0 ? <div>—</div> : null}
                  </div>
                </div>
                <div>
                  <div className="badge">Maybe</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {(lists[evt.id]?.maybe || []).map((u) => (<div key={u.id}>{u.name}</div>))}
                    {(lists[evt.id]?.maybe || []).length === 0 ? <div>—</div> : null}
                  </div>
                </div>
                <div>
                  <div className="badge">No</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {(lists[evt.id]?.no || []).map((u) => (<div key={u.id}>{u.name}</div>))}
                    {(lists[evt.id]?.no || []).length === 0 ? <div>—</div> : null}
                  </div>
                </div>
              </div>
            </details>
          </div>
        );
      })}
      {grouped.length === 0 ? <div className="muted">No upcoming events.</div> : null}
    </div>
  );
}


