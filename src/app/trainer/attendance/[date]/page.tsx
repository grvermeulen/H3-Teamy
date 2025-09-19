"use client";

import { useEffect, useMemo, useState } from "react";

type Params = { params: { date: string } };
type User = { id: string; name: string };

export default function SessionChecklist({ params }: Params) {
  const date = params.date;
  const [roster, setRoster] = useState<User[]>([]);
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isTrainer, setIsTrainer] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const st = await fetch("/api/trainer/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ isTrainer: false }));
      if (!mounted) return;
      setIsTrainer(Boolean(st?.isTrainer));
      // Roster: list all users by name
      const users = await fetch("/api/users", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ users: [] }));
      const list: User[] = Array.isArray(users?.users) ? users.users : [];
      if (!mounted) return;
      setRoster(list);
      const att = await fetch(`/api/training/attendance?date=${encodeURIComponent(date)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ presentUserIds: [] }));
      if (!mounted) return;
      setPresent(new Set((att?.presentUserIds || []) as string[]));
      setDirty(false);
    }
    load();
    return () => { mounted = false; };
  }, [date]);

  function toggle(uid: string) {
    setPresent((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
    setDirty(true);
  }

  async function onSave() {
    setSaving(true);
    try {
      const ids = Array.from(present);
      const res = await fetch("/api/training/attendance", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ date, presentUserIds: ids }) });
      if (!res.ok) {
        const txt = await res.text();
        alert(`Save failed: ${txt}`);
        return;
      }
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  const sorted = useMemo(() => {
    return roster.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [roster]);

  if (isTrainer === false) {
    return <div className="container"><h1>{date}</h1><div className="muted">You do not have access.</div></div>;
  }
  if (isTrainer === null) {
    return <div className="container"><div className="muted">Loading…</div></div>;
  }

  return (
    <main>
      <div className="container">
        <h1>Attendance – {date}</h1>
        <div className="card" style={{ position: "sticky", top: 0, zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="muted">Present: {present.size}</div>
            <div className="row" style={{ gap: 8 }}>
              <button onClick={onSave} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
        <div className="list">
          {sorted.map((u) => (
            <button key={u.id} className="card" onClick={() => toggle(u.id)} style={{ textAlign: "left", borderColor: present.has(u.id) ? "#33d17a" : undefined }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>{u.name}</div>
                <div className="badge" style={{ background: present.has(u.id) ? "#164d2f" : undefined }}>{present.has(u.id) ? "Present" : "Tap to mark"}</div>
              </div>
            </button>
          ))}
          {sorted.length === 0 ? <div className="muted">No members found.</div> : null}
        </div>
      </div>
    </main>
  );
}


