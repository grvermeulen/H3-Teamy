"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Session = { date: string };

export default function TrainerAttendanceList() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isTrainer, setIsTrainer] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const st = await fetch("/api/trainer/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ isTrainer: false }));
      if (!mounted) return;
      setIsTrainer(Boolean(st?.isTrainer));
      const res = await fetch(`/api/training/sessions`, { cache: "no-store" });
      const data = await res.json();
      if (!mounted) return;
      setSessions((data?.sessions || []) as Session[]);
    }
    load();
    return () => { mounted = false; };
  }, []);

  if (isTrainer === false) {
    return <div className="container"><h1>Training attendance</h1><div className="muted">You do not have access.</div></div>;
  }
  if (isTrainer === null) {
    return <div className="container"><div className="muted">Loading…</div></div>;
  }

  return (
    <main>
      <div className="container">
        <h1 style={{ marginBottom: 8 }}>Training attendance</h1>
        
        <div className="list">
          {sessions.map((s) => (
            <a className="card" key={s.date} href={`/trainer/attendance/${s.date}`} style={{ textDecoration: "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, color: "#e6edf7" }}>{s.date}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{new Date(s.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })} session</div>
                </div>
                <div className="badge">Open</div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}


