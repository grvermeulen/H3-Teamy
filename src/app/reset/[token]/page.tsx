"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

export default function ResetWithTokenPage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token as string) || "";
  const router = useRouter();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setNotice(null);
    if (p1 !== p2 || p1.length < 8) { setNotice("Passwords must match and be at least 8 characters."); return; }
    const res = await fetch("/api/auth/password/reset-confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword: p1 }),
    });
    if (res.ok) {
      setNotice("Password updated. You can now sign in.");
      setTimeout(() => router.push("/login"), 1000);
    } else {
      const data = await res.json().catch(() => ({} as any));
      setNotice(data?.error || "Reset failed");
    }
  }

  return (
    <main>
      <div className="container">
        <h1>Choose a new password</h1>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input placeholder="New password" type="password" value={p1} onChange={(e) => setP1(e.target.value)} style={{ padding: 6, borderRadius: 6 }} />
            <input placeholder="Confirm password" type="password" value={p2} onChange={(e) => setP2(e.target.value)} style={{ padding: 6, borderRadius: 6 }} />
            <button onClick={submit}>Update password</button>
          </div>
          {notice ? <div className="muted" style={{ marginTop: 10 }}>{notice}</div> : null}
        </div>
      </div>
    </main>
  );
}


