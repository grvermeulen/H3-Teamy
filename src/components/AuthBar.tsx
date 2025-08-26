"use client";

import { useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

type User = { id: string; firstName: string; lastName: string } | null;

export default function AuthBar() {
  const [user, setUser] = useState<User>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [redeem, setRedeem] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const { data: session, status } = useSession();

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/me", { cache: "no-store" });
      const data = await res.json();
      setUser(data.user);
      if (data.user) {
        setFirstName(data.user.firstName);
        setLastName(data.user.lastName);
      }
    })();
  }, [status]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName, lastName }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      // If authenticated, also link profile to cookie user
      try {
        await fetch("/api/auth/link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ firstName, lastName }),
        });
      } catch {}
      setUser({ id: "me", firstName, lastName });
      setNotice("Saved");
      setTimeout(() => setNotice(null), 2000);
    } catch (e: any) {
      setNotice(e?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function generateLink() {
    const res = await fetch("/api/link/start", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setLinkCode(data.code as string);
    }
  }

  async function redeemLink() {
    if (!redeem) return;
    const res = await fetch("/api/link/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: redeem }) });
    if (res.ok) {
      // reload identity
      const me = await fetch("/api/me", { cache: "no-store" }).then((r) => r.json());
      setUser(me.user);
      setFirstName(me.user?.firstName || "");
      setLastName(me.user?.lastName || "");
    }
  }

  const displayName = session?.user?.name || (user ? `${user.firstName} ${user.lastName}`.trim() : "");

  return (
    <div className="container" style={{ display: "flex", gap: 8, alignItems: "center", paddingTop: 8 }}>
      {status === "authenticated" ? (
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <div className="muted">Signed in as {displayName}</div>
          <button onClick={generateLink} style={{ padding: "4px 8px", borderRadius: 6 }}>Link Device</button>
          {linkCode ? <span className="badge">Code: {linkCode}</span> : null}
          <button onClick={() => signOut({ callbackUrl: "/" })} style={{ padding: "4px 8px", borderRadius: 6 }}>Sign out</button>
        </div>
      ) : (
        <div className="row" style={{ gap: 6 }}>
          <input
            placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            style={{ padding: 6, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "white" }}
          />
          <input
            placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            style={{ padding: 6, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "white" }}
          />
          <button onClick={save} disabled={saving} style={{ padding: "6px 10px", borderRadius: 6 }}>
            Save
          </button>
          <button onClick={() => signIn("google")} style={{ padding: "6px 10px", borderRadius: 6 }}>Sign in with Google</button>
          <input
            placeholder="Enter link code"
            value={redeem}
            onChange={(e) => setRedeem(e.target.value.toUpperCase())}
            style={{ padding: 6, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "white" }}
          />
          <button onClick={redeemLink} style={{ padding: "6px 10px", borderRadius: 6 }}>Redeem</button>
        </div>
      )}
      {notice ? <div className="muted">{notice}</div> : null}
    </div>
  );
}


