"use client";

import { useState } from "react";

export default function ResetRequestPage() {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);

  async function submit() {
    setNotice(null);
    setDevToken(null);
    const res = await fetch("/api/auth/password/reset-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({} as any));
      setNotice("If the email exists, we sent a reset link.");
      if (data?.token) setDevToken(data.token as string);
    } else {
      setNotice("If the email exists, we sent a reset link.");
    }
  }

  return (
    <main>
      <div className="container">
        <h1>Reset password</h1>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 6, borderRadius: 6 }} />
            <button onClick={submit}>Send reset link</button>
          </div>
          {notice ? <div className="muted" style={{ marginTop: 10 }}>{notice}</div> : null}
          {devToken ? (
            <div className="muted" style={{ marginTop: 10 }}>
              Dev token: <a href={`/reset/${encodeURIComponent(devToken)}`}>{devToken}</a>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}


