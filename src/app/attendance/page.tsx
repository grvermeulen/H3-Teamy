"use client";

import { useEffect, useMemo, useState } from "react";
import { toYMD } from "../../lib/training";

type Row = { userId: string; name: string; attended: number; total: number; pct: number };

export default function AttendanceOverview() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [recentRows, setRecentRows] = useState<Row[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [me, setMe] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      const season = await fetch("/api/training/overview", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ list: [], total: 0 }));
      if (!mounted) return;
      setRows(season?.list || []);
      setTotal(season?.total || 0);

      // Recent 14 days window
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
      const recent = await fetch(`/api/training/overview?from=${encodeURIComponent(toYMD(from))}&to=${encodeURIComponent(toYMD(now))}`, { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ list: [], total: 0 }));
      if (!mounted) return;
      setRecentRows(recent?.list || []);
      setRecentTotal(recent?.total || 0);

      const prof = await fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ user: null }));
      if (!mounted) return;
      setMe(prof?.user?.id || "");
    }
    load();
    return () => { mounted = false; };
  }, []);

  const my = useMemo(() => rows.find((r) => r.userId === me), [rows, me]);
  const myRecent = useMemo(() => recentRows.find((r) => r.userId === me), [recentRows, me]);
  const sorted = useMemo(() => rows.slice().sort((a, b) => b.attended - a.attended), [rows]);
  const recentMap = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of recentRows) m.set(r.userId, r);
    return m;
  }, [recentRows]);

  return (
    <main>
      <div className="container">
        <h1>Attendance</h1>
        <div className="muted" style={{ marginBottom: 12 }}><a href="/">← Back to matches</a></div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="muted">Season total trainings: {total}</div>
          {my ? <div style={{ marginTop: 6 }}>You: {my.attended}/{my.total} ({my.pct}%)</div> : null}
          {myRecent ? <div className="muted" style={{ marginTop: 6 }}>Last 14 days: {myRecent.attended}/{recentTotal} ({myRecent.pct}%)</div> : null}
        </div>
        <div className="list">
          {sorted.map((r) => {
            const rr = recentMap.get(r.userId);
            return (
              <div key={r.userId} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>{r.name}</div>
                  <div className="row" style={{ gap: 8 }}>
                    <div className="badge">{r.attended}/{r.total} ({r.pct}%)</div>
                    {rr ? <div className="badge">{rr.attended}/{recentTotal} ({rr.pct}%)</div> : null}
                  </div>
                </div>
              </div>
            );
          })}
          {sorted.length === 0 ? <div className="muted">No data yet.</div> : null}
        </div>
      </div>
    </main>
  );
}


