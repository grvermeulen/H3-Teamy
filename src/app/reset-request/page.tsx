"use client";

import { useState } from "react";

export default function ResetRequestPage() {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  async function submit() {
    setNotice(null);
    const res = await fetch("/api/auth/password/reset-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    setNotice("If the email exists, we sent a reset link.");
    if (data?.token) setToken(data.token as string);
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
          {token ? (
            <div className="muted" style={{ marginTop: 10 }}>
              Dev token: <a href={`/reset/${token}`}>{token}</a>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}


