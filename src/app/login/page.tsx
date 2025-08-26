"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function Content() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl") || "/";

  async function register() {
    setNotice(null);
    const res = await fetch("/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: signupEmail, password: signupPassword, firstName, lastName }) });
    if (!res.ok) { setNotice("Registration failed"); return; }
    setNotice("Registered. You can now sign in.");
  }

  async function login() {
    setNotice(null);
    await signIn("credentials", { email, password, redirect: true, callbackUrl });
    // next-auth handles navigation
  }

  return (
    <main>
      <div className="container">
        <h1>Login</h1>
        <div className="muted" style={{ marginTop: 6 }}>
          <a href={callbackUrl}>Back</a>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Email &amp; Password</h3>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 6, borderRadius: 6 }} />
            <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ padding: 6, borderRadius: 6 }} />
            <button onClick={login}>Sign in</button>
          </div>
          <h4 style={{ marginTop: 12 }}>Or create an account</h4>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input placeholder="Email" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} style={{ padding: 6, borderRadius: 6 }} />
            <input placeholder="Password" type="password" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} style={{ padding: 6, borderRadius: 6 }} />
            <input placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} style={{ padding: 6, borderRadius: 6 }} />
            <input placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} style={{ padding: 6, borderRadius: 6 }} />
            <button onClick={register}>Create account</button>
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <h3>Google</h3>
          <button onClick={() => signIn("google", { callbackUrl })}>Sign in with Google</button>
        </div>

        {notice ? <div className="muted" style={{ marginTop: 10 }}>{notice}</div> : null}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}


