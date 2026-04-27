"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  splitTrainingSessionDatesForDisplay,
  toYMD,
} from "../../../lib/training";

type Session = { date: string };

function SessionRow({ date }: { date: string }) {
  return (
    <Link
      className="card"
      href={`/trainer/attendance/${date}`}
      style={{ textDecoration: "none" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>{date}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Training op{" "}
            {new Date(date + "T12:00:00").toLocaleDateString("nl-NL", {
              weekday: "long",
            })}
          </div>
        </div>
        <div className="badge">Open</div>
      </div>
    </Link>
  );
}

export default function TrainerAttendanceList() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isTrainer, setIsTrainer] = useState<boolean | null>(null);

  const { recentPast, olderPast, upcoming } = useMemo(() => {
    const dates = sessions.map((s) => s.date);
    return splitTrainingSessionDatesForDisplay(dates, toYMD(new Date()), 3);
  }, [sessions]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const st = await fetch("/api/trainer/status", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ isTrainer: false }));
      if (!mounted) return;
      setIsTrainer(Boolean(st?.isTrainer));
      const res = await fetch(`/api/training/sessions`, { cache: "no-store" });
      const data = await res.json();
      if (!mounted) return;
      setSessions((data?.sessions || []) as Session[]);
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  if (isTrainer === false) {
    return (
      <div className="container">
        <h1>Trainingsopkomst</h1>
        <div className="muted">Je hebt geen toegang.</div>
      </div>
    );
  }
  if (isTrainer === null) {
    return (
      <div className="container">
        <div className="muted">Laden…</div>
      </div>
    );
  }

  const total = sessions.length;

  return (
    <main>
      <div className="container">
        <h1 style={{ marginBottom: 8 }}>Trainingsopkomst</h1>

        <div className="list">
          {recentPast.map((date) => (
            <SessionRow key={date} date={date} />
          ))}
          {olderPast.length > 0 ? (
            <details style={{ marginBottom: 4 }}>
              <summary
                className="muted"
                style={{ cursor: "pointer", fontWeight: 600 }}
              >
                Eerdere trainingen dit seizoen ({olderPast.length})
              </summary>
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {olderPast.map((date) => (
                  <SessionRow key={date} date={date} />
                ))}
              </div>
            </details>
          ) : null}
          {upcoming.map((date) => (
            <SessionRow key={date} date={date} />
          ))}
          {total === 0 ? <div className="muted">Nog geen sessies.</div> : null}
        </div>
      </div>
    </main>
  );
}
