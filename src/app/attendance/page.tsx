"use client";

import { useEffect, useMemo, useState } from "react";
import { toYMD } from "../../lib/training";
import { getBadgeForAttendance } from "../../lib/badges";
import { Card, EmptyState, Stack } from "../../components/ui";

type Row = {
  userId: string;
  name: string;
  attended: number;
  total: number;
  pct: number;
};

export default function AttendanceOverview() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [recentRows, setRecentRows] = useState<Row[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [me, setMe] = useState<string>("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const season = await fetch("/api/training/overview", {
        cache: "no-store",
      })
        .then((r) => r.json())
        .catch(() => ({ list: [], total: 0 }));
      if (!mounted) return;
      setRows(season?.list || []);
      setTotal(season?.total || 0);

      // Recente 14-dagen window
      const now = new Date();
      const from = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 14,
      );
      const recent = await fetch(
        `/api/training/overview?from=${encodeURIComponent(toYMD(from))}&to=${encodeURIComponent(toYMD(now))}`,
        { cache: "no-store" },
      )
        .then((r) => r.json())
        .catch(() => ({ list: [], total: 0 }));
      if (!mounted) return;
      setRecentRows(recent?.list || []);
      setRecentTotal(recent?.total || 0);

      const prof = await fetch("/api/profile", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ user: null }));
      if (!mounted) return;
      setMe(prof?.user?.id || "");
      setLoaded(true);
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const my = useMemo(() => rows.find((r) => r.userId === me), [rows, me]);
  const myRecent = useMemo(
    () => recentRows.find((r) => r.userId === me),
    [recentRows, me],
  );
  const sorted = useMemo(
    () => rows.slice().sort((a, b) => b.attended - a.attended),
    [rows],
  );
  const recentMap = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of recentRows) m.set(r.userId, r);
    return m;
  }, [recentRows]);

  return (
    <main>
      <div className="container">
        <h1>Opkomst</h1>

        <Card style={{ marginBottom: 12 }}>
          <Stack gap="2">
            <div className="muted">Trainingen dit seizoen: {total}</div>
            {my ? (
              <div>
                Jij: <strong>{my.attended}</strong>/{my.total} ({my.pct}%)
              </div>
            ) : null}
            {myRecent ? (
              <div className="muted">
                Laatste 14 dagen: {myRecent.attended}/{recentTotal} (
                {myRecent.pct}%)
              </div>
            ) : null}
          </Stack>
        </Card>

        <div className="list">
          {sorted.map((r) => {
            const rr = recentMap.get(r.userId);
            const badge = getBadgeForAttendance(r.pct); // op basis van seizoen
            return (
              <Card key={r.userId}>
                <Stack direction="row" justify="between" align="center" gap="3">
                  <div style={{ minWidth: 0, fontWeight: 500 }}>{r.name}</div>
                  <Stack direction="row" gap="2">
                    <span className="badge" title="Seizoen">
                      {r.attended}/{r.total} ({r.pct}%)
                    </span>
                    {rr ? (
                      <span className="badge" title="Laatste 14 dagen">
                        {rr.attended}/{recentTotal} ({rr.pct}%)
                      </span>
                    ) : null}
                    <span className={`badge badge-${badge.slug}`}>
                      {badge.label}
                    </span>
                  </Stack>
                </Stack>
              </Card>
            );
          })}
          {loaded && sorted.length === 0 ? (
            <EmptyState
              title="Nog geen opkomstdata"
              body="Zodra de trainer een sessie aftekent verschijnt het hier."
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
