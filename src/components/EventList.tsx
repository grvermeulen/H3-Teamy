"use client";

import * as Sentry from "@sentry/nextjs";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TeamEvent, RsvpStatus } from "../types";
import { splitPastAndFutureByStart } from "../lib/listSplitPast";
import GenerateReportButton from "./GenerateReportButton";
import ReportPreview from "./ReportPreview";
import MvpVoteButton from "./MvpVoteButton";
import SpaceInvadersLauncher from "./spaceInvaders/SpaceInvadersLauncher";
import { useSession } from "./SessionContext";
import { formatEventDate, formatEventTime } from "../lib/datetime";

/** Props voor {@link EventList}. */
type Props = {
  /** Teamwedstrijden uit de iCal-feed (server component → client). */
  events: TeamEvent[];
};

type RsvpMap = Record<string, RsvpStatus>;

/**
 * RSVP-lijst per wedstrijd: tellingen, eigen status (ingelogd), optionele namenlijsten
 * in een `<details>` (lazy). Ververs bij focus, tab-zichtbaarheid en handmatige Refresh.
 *
 * Na terugkeren vanuit een andere app worden `lists` en `loadedLists` samen geleegd en
 * open details opnieuw geladen, zodat namen niet “vast” leeg blijven.
 *
 * @param props - Componentprops.
 * @param props.events - Te tonen events (chronologisch gesorteerd in de UI).
 */
export default function EventList({ events }: Props): React.JSX.Element {
  const [rsvpMap, setRsvpMap] = useState<RsvpMap>({});
  const [counts, setCounts] = useState<
    Record<string, { yes: number; no: number; maybe: number }>
  >({});
  const [lists, setLists] = useState<
    Record<
      string,
      {
        yes: { id: string; name: string }[];
        no: { id: string; name: string }[];
        maybe: { id: string; name: string }[];
      }
    >
  >({});
  const [loadedLists, setLoadedLists] = useState<Record<string, boolean>>({});
  /** Event-ids waarvan de RSVP-details nu open staan (voor refetch na loadAll). */
  const openRsvpDetailIdsRef = useRef<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  const [nowTs, setNowTs] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const session = useSession();
  const loggedIn = session.loggedIn;
  const authChecked = !session.loading;
  const [notice, setNotice] = useState<string | null>(null);

  const loadedListsRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    loadedListsRef.current = loadedLists;
  }, [loadedLists]);

  /**
   * Haalt volledige RSVP-data voor één event (tellingen + yes/maybe/no-namen).
   *
   * @param id - `eventId` (Sportlink/event-sleutel).
   * @param opts - Opties; `force: true` slaat de “al geladen”-cache over (nodig na `loadAll`).
   */
  const loadRsvpListDetail = useCallback(
    async (id: string, opts?: { force?: boolean }) => {
      if (!opts?.force && loadedListsRef.current[id]) return;
      try {
        const res = await fetch(
          `/api/rsvp/list?eventId=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;

        const data = await res.json();
        setCounts((prev) => ({ ...prev, [id]: data.counts }));
        setLists((prev) => ({ ...prev, [id]: data.lists }));
        setLoadedLists((prev) => ({ ...prev, [id]: true }));
      } catch (error: unknown) {
        Sentry.captureException(error);
      }
    },
    [],
  );

  const isLoadAllInFlightRef = useRef(false);

  /**
   * Laadt publieke tellingen voor alle events; als de gebruiker ingelogd is ook eigen RSVP-status.
   * Wis naamlijst-cache (`lists` + `loadedLists`) zodat die niet out-of-sync raakt met geleegde data.
   * Open RSVP-details worden direct opnieuw opgehaald (mobiel / app-switch).
   */
  const loadAll = useCallback(async () => {
    if (isLoadAllInFlightRef.current) return;
    isLoadAllInFlightRef.current = true;
    setIsRefreshing(true);

    try {
      const countsEntries = await Promise.all(
        events.map(async (e) => {
          const res = await fetch(
            `/api/rsvp/list?eventId=${encodeURIComponent(e.id)}&countsOnly=1`,
            { cache: "no-store" },
          );
          if (!res.ok) return [e.id, { yes: 0, no: 0, maybe: 0 }] as const;
          const data = await res.json();
          return [
            e.id,
            data.counts as { yes: number; no: number; maybe: number },
          ] as const;
        }),
      );
      const cMap: Record<string, { yes: number; no: number; maybe: number }> =
        {};
      for (const [id, c] of countsEntries) {
        cMap[id] = c;
      }
      setCounts(cMap);

      if (!loggedIn) {
        setRsvpMap({});
        setLists({});
        setLoadedLists({});
        return;
      }

      const rsvpEntries = await Promise.all(
        events.map(async (e) => {
          const res = await fetch(
            `/api/rsvp?eventId=${encodeURIComponent(e.id)}`,
            { cache: "no-store" },
          );
          if (!res.ok) return [e.id, null] as const;
          const data = await res.json();
          return [e.id, (data?.status ?? null) as RsvpStatus] as const;
        }),
      );
      const map: RsvpMap = {};
      for (const [id, status] of rsvpEntries) map[id] = status;
      setRsvpMap(map);
      setLists({});
      setLoadedLists({});
      const visibleEventIds = new Set(events.map((event) => event.id));
      const openIds = [...openRsvpDetailIdsRef.current].filter((eventId) =>
        visibleEventIds.has(eventId),
      );
      openRsvpDetailIdsRef.current = new Set(openIds);
      await Promise.all(
        openIds.map((id) => loadRsvpListDetail(id, { force: true })),
      );
    } finally {
      isLoadAllInFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [events, loggedIn, loadRsvpListDetail]);

  useEffect(() => {
    if (authChecked) {
      void loadAll();
    }
  }, [authChecked, loadAll]);

  useEffect(() => {
    function onFocus() {
      if (authChecked) {
        void loadAll();
      }
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [authChecked, loadAll]);

  /** Mobiel: bij terugkeren naar tab/PWA vaak wel visibilitychange, niet altijd window focus. */
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible" && authChecked) {
        void loadAll();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [authChecked, loadAll]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setNowTs(Date.now());
  }, []);

  /**
   * Zet RSVP-status voor het huidige account (optimistische UI, daarna serverbevestiging).
   *
   * @param id - Event-id.
   * @param status - Nieuwe status of `null` om te wissen.
   */
  async function setRsvp(id: string, status: RsvpStatus) {
    const prev = rsvpMap[id] || null;
    setRsvpMap((p) => ({ ...p, [id]: status }));
    const res = await fetch(`/api/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: id, status }),
    });
    if (res.status === 412) {
      // Profiel incompleet → optimistic UI terugdraaien en doorsturen naar profiel
      setRsvpMap((p) => ({ ...p, [id]: prev }));
      setNotice(
        "Vul eerst je voor- en achternaam in op je profiel om te kunnen RSVP'en. Je wordt doorgestuurd…",
      );
      if (typeof window !== "undefined") {
        setTimeout(() => window.location.assign("/profile"), 1500);
      }
      return;
    }
    // Refresh counts/lists for this event
    const listRes = await fetch(
      `/api/rsvp/list?eventId=${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    if (listRes.ok) {
      const data = await listRes.json();
      setCounts((p) => ({ ...p, [id]: data.counts }));
      setLists((p) => ({ ...p, [id]: data.lists }));
      setLoadedLists((p) => ({ ...p, [id]: true }));
    }
  }

  /**
   * Zorgt dat namenlijsten voor dit event geladen zijn (geen dubbele fetch als al in cache).
   *
   * @param id - Event-id.
   */
  function ensureListsLoaded(id: string) {
    void loadRsvpListDetail(id);
  }

  const { recentPast, olderPast, future } = useMemo(
    () => splitPastAndFutureByStart(events, nowTs || 0, 3),
    [events, nowTs],
  );

  const visibleCount = recentPast.length + olderPast.length + future.length;

  function renderEventCard(evt: TeamEvent) {
    const start = new Date(evt.start);
    const end = evt.end ? new Date(evt.end) : undefined;
    const status = rsvpMap[evt.id] || null;
    return (
      <div className="card" key={evt.id}>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <div className="grow">
            <div className="eventTitle">{evt.title}</div>
            <div className="eventMeta muted">
              <span className="badge badge-date" suppressHydrationWarning>
                {mounted ? formatEventDate(start) : ""}
              </span>
              <span className="badge badge-time" suppressHydrationWarning>
                {mounted ? formatEventTime(start, end) : ""}
              </span>
              {evt.location ? (
                <span className="badge">{evt.location}</span>
              ) : null}
              {counts[evt.id] ? (
                <span className="badge" aria-label="RSVP-overzicht">
                  Ja <span className="count-yes">{counts[evt.id].yes}</span> ·
                  Misschien{" "}
                  <span className="count-maybe">{counts[evt.id].maybe}</span> ·
                  Nee <span className="count-no">{counts[evt.id].no}</span>
                </span>
              ) : null}
            </div>
          </div>
          {loggedIn ? (
            <div
              className="rsvp"
              style={{ width: "100%", justifyContent: "flex-end" }}
            >
              <button
                className={status === "yes" ? "active-yes" : ""}
                aria-pressed={status === "yes"}
                onClick={() => setRsvp(evt.id, status === "yes" ? null : "yes")}
              >
                Ja
              </button>
              <button
                className={status === "maybe" ? "active-maybe" : ""}
                aria-pressed={status === "maybe"}
                onClick={() =>
                  setRsvp(evt.id, status === "maybe" ? null : "maybe")
                }
              >
                Misschien
              </button>
              <button
                className={status === "no" ? "active-no" : ""}
                aria-pressed={status === "no"}
                onClick={() => setRsvp(evt.id, status === "no" ? null : "no")}
              >
                Nee
              </button>
            </div>
          ) : null}
        </div>
        {loggedIn ? (
          <div
            className="rsvp"
            style={{
              justifyContent: "flex-end",
              marginTop: 8,
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <ReportPreview eventId={evt.id} />
            <MvpVoteButton eventId={evt.id} />
          </div>
        ) : null}
        {loggedIn ? (
          <GenerateReportButton eventId={evt.id} opponent={evt.title} />
        ) : null}
        {evt.description ? (
          <div className="muted" style={{ marginTop: 8 }}>
            {evt.description}
          </div>
        ) : null}
        {loggedIn ? (
          <details
            style={{ marginTop: 10 }}
            onToggle={(e) => {
              const el = e.currentTarget as HTMLDetailsElement;
              if (el.open) {
                openRsvpDetailIdsRef.current.add(evt.id);
                void ensureListsLoaded(evt.id);
              } else {
                openRsvpDetailIdsRef.current.delete(evt.id);
              }
            }}
          >
            <summary className="muted">RSVP-lijst tonen</summary>
            <div className="rsvp-columns">
              <div>
                <div className="badge">Ja</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {(lists[evt.id]?.yes || []).map((u) => (
                    <div key={u.id}>{u.name}</div>
                  ))}
                  {(lists[evt.id]?.yes || []).length === 0 ? (
                    <div>—</div>
                  ) : null}
                </div>
              </div>
              <div>
                <div className="badge">Misschien</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {(lists[evt.id]?.maybe || []).map((u) => (
                    <div key={u.id}>{u.name}</div>
                  ))}
                  {(lists[evt.id]?.maybe || []).length === 0 ? (
                    <div>—</div>
                  ) : null}
                </div>
              </div>
              <div>
                <div className="badge">Nee</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {(lists[evt.id]?.no || []).map((u) => (
                    <div key={u.id}>{u.name}</div>
                  ))}
                  {(lists[evt.id]?.no || []).length === 0 ? <div>—</div> : null}
                </div>
              </div>
            </div>
          </details>
        ) : null}
      </div>
    );
  }

  // Niets renderen tot de auth-check klaar is
  if (!authChecked) {
    return (
      <div className="list">
        <div className="muted">Laden…</div>
      </div>
    );
  }

  return (
    <div className="list">
      <div
        className="row"
        style={{
          marginBottom: 12,
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <button onClick={() => void loadAll()} disabled={isRefreshing}>
          {isRefreshing ? "Vernieuwen…" : "Vernieuwen"}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          Tip: open de app opnieuw of druk op Vernieuwen
        </span>
      </div>
      {notice ? (
        <div
          role="alert"
          className="card"
          style={{
            marginBottom: 12,
            borderColor: "var(--accent)",
            color: "var(--text)",
          }}
        >
          {notice}
        </div>
      ) : null}
      {recentPast.map((evt) => renderEventCard(evt))}
      {olderPast.length > 0 ? (
        <details style={{ marginBottom: 12 }}>
          <summary
            className="muted"
            style={{ cursor: "pointer", fontWeight: 600 }}
          >
            Vorige wedstrijden ({olderPast.length})
          </summary>
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {olderPast.map((evt) => renderEventCard(evt))}
          </div>
        </details>
      ) : null}
      {future.map((evt) => renderEventCard(evt))}
      <SpaceInvadersLauncher />
      {visibleCount === 0 ? (
        <div className="muted">Geen recente of aankomende wedstrijden.</div>
      ) : null}
    </div>
  );
}
