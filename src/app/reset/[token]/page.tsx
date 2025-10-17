"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

export default function ResetConfirmPage() {
  const params = useParams();
  const router = useRouter();
  const token = (params?.token as string) || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setNotice(null);
    if (!password || password !== confirm) {
      setNotice("Passwords do not match");
      return;
    }
    const res = await fetch("/api/auth/password/reset-confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (res.ok) {
      setNotice("Password updated. You can now sign in.");
      setTimeout(() => router.push("/login"), 1200);
    } else {
      const data = await res.json().catch(() => ({}));
      setNotice(data?.error || "Could not reset password");
    }
  }

  return (
    <main>
      <div className="container">
        <h1>Choose a new password</h1>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input placeholder="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ padding: 6, borderRadius: 6 }} />
            <input placeholder="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ padding: 6, borderRadius: 6 }} />
            <button onClick={submit}>Reset password</button>
          </div>
          {notice ? <div className="muted" style={{ marginTop: 10 }}>{notice}</div> : null}
        </div>
      </div>
    </main>
  );
}


