"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Roles = { admin?: boolean; trainer?: boolean; player?: boolean };
type UserRow = { id: string; name: string; roles: Roles };

export default function AdminUsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (res.status === 403) { setForbidden(true); return; }
      const data = await res.json();
      if (!mounted) return;
      setRows((data?.users || []) as UserRow[]);
      setDirty(false);
    }
    load();
    return () => { mounted = false; };
  }, []);

  function toggle(id: string, key: keyof Roles) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, roles: { ...r.roles, [key]: !r.roles[key] } } : r));
    setDirty(true);
  }

  async function onSave() {
    setSaving(true);
    try {
      const items = rows.map((r) => ({ id: r.id, roles: r.roles }));
      const res = await fetch("/api/admin/users", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
      if (!res.ok) {
        const t = await res.text();
        alert(`Save failed: ${t}`);
        return;
      }
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  const sorted = useMemo(() => rows.slice().sort((a, b) => a.name.localeCompare(b.name)), [rows]);

  if (forbidden) return <div className="container"><h1>Admin</h1><div className="muted">You do not have access.</div><div style={{ marginTop: 12 }}><Link href={"/" as any}>← Back to matches</Link></div></div>;

  return (
    <main>
      <div className="container">
        <h1>Admin</h1>
        <div className="muted" style={{ marginBottom: 12 }}><Link href={"/" as any}>← Back to matches</Link></div>
        <div className="card" style={{ position: "sticky", top: 0, zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="muted">User roles</div>
            <button onClick={onSave} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
        <div className="list">
          {sorted.map((u) => (
            <div key={u.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>{u.name}</div>
                <div className="row" style={{ gap: 8 }}>
                  <label className="badge" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={!!u.roles.player} onChange={() => toggle(u.id, "player")} /> Player
                  </label>
                  <label className="badge" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={!!u.roles.trainer} onChange={() => toggle(u.id, "trainer")} /> Trainer
                  </label>
                  <label className="badge" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={!!u.roles.admin} onChange={() => toggle(u.id, "admin")} /> Admin
                  </label>
                </div>
              </div>
            </div>
          ))}
          {sorted.length === 0 ? <div className="muted">No users found.</div> : null}
        </div>
      </div>
    </main>
  );
}


