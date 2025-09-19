"use client";

import { useEffect, useMemo, useState } from "react";

type Row = { userId: string; name: string; attended: number; total: number; pct: number };

export default function AttendanceOverview() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [me, setMe] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      const ov = await fetch("/api/training/overview", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ list: [], total: 0 }));
      if (!mounted) return;
      setRows(ov?.list || []);
      setTotal(ov?.total || 0);
      const prof = await fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ user: null }));
      if (!mounted) return;
      setMe(prof?.user?.id || "");
    }
    load();
    return () => { mounted = false; };
  }, []);

  const my = useMemo(() => rows.find((r) => r.userId === me), [rows, me]);
  const sorted = useMemo(() => rows.slice().sort((a, b) => b.attended - a.attended), [rows]);

  return (
    <main>
      <div className="container">
        <h1>Attendance</h1>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="muted">Season total trainings: {total}</div>
          {my ? <div style={{ marginTop: 6 }}>You: {my.attended}/{my.total} ({my.pct}%)</div> : null}
        </div>
        <div className="list">
          {sorted.map((r) => (
            <div key={r.userId} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>{r.name}</div>
                <div className="badge">{r.attended}/{r.total} ({r.pct}%)</div>
              </div>
            </div>
          ))}
          {sorted.length === 0 ? <div className="muted">No data yet.</div> : null}
        </div>
      </div>
    </main>
  );
}


