"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Profile = { id: string; firstName: string; lastName: string; email: string } | null;
type Roles = { admin: boolean; trainer: boolean; player: boolean };

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsLink, setNeedsLink] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [roles, setRoles] = useState<Roles>({ admin: false, trainer: false, player: true });

  async function load() {
    const [p, s, a, t] = await Promise.all([
      fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/identity/status", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ isAdmin: false })),
      fetch("/api/trainer/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ isTrainer: false })),
    ]);
    setProfile(p.user);
    if (p.user) {
      setFirstName(p.user.firstName || "");
      setLastName(p.user.lastName || "");
      setEmail(p.user.email || "");
    }
    setNeedsLink(!!s.needsLink);
    setRoles({ admin: !!a?.isAdmin, trainer: !!t?.isTrainer, player: true });
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email }),
      });
      if (res.status === 409) {
        setNotice("Email already in use");
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setNotice("Saved");
      setTimeout(() => setNotice(null), 2000);
      await load();
    } catch (e: any) {
      setNotice(e?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function adopt() {
    setAdopting(true);
    try {
      const res = await fetch("/api/identity/adopt", { method: "POST" });
      if (!res.ok) throw new Error(`Import failed (${res.status})`);
      setNeedsLink(false);
      await load();
      setNotice("Imported device data");
      setTimeout(() => setNotice(null), 2000);
    } catch (e: any) {
      setNotice(e?.message || "Could not import");
    } finally {
      setAdopting(false);
    }
  }

  return (
    <main>
      <div className="container">
        <h1>My Profile</h1>
        

        {needsLink ? (
          <div className="card" style={{ maxWidth: 520, marginBottom: 12, border: "1px solid #8b5cf6" }}>
            <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <div className="muted">We found RSVPs on this device. Import them into your account?</div>
              <button type="button" disabled={adopting} onClick={adopt}>Import</button>
            </div>
          </div>
        ) : null}

        <div className="card" style={{ maxWidth: 520 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="badge">Roles:</div>
            <div className="muted">{roles.admin ? "Admin" : null}{roles.admin && (roles.trainer || roles.player) ? ", " : ""}{roles.trainer ? "Trainer" : null}{roles.trainer && roles.player ? ", " : ""}{roles.player ? "Player" : null}</div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="grow">
              <label className="muted" htmlFor="first">First name</label>
              <input id="first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="grow">
              <label className="muted" htmlFor="last">Last name</label>
              <input id="last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div className="grow">
              <label className="muted" htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 16, alignItems: "center" }}>
            <button type="button" disabled={saving} onClick={save}>Save</button>
            {notice ? <span className="muted" style={{ marginLeft: 8 }}>{notice}</span> : null}
          </div>
        </div>
      </div>
    </main>
  );
}


