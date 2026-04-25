"use client";

import * as Sentry from "@sentry/nextjs";
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
  const [invitationCode, setInvitationCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl") || "/";

  async function register() {
    setNotice(null);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: signupEmail,
        password: signupPassword,
        firstName,
        lastName,
        invitationCode,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setNotice(data.error || "Registration failed");
      return;
    }
    setNotice("Registered. You can now sign in.");
  }

  async function login() {
    setNotice(null);
    try {
      await signIn("credentials", {
        email,
        password,
        redirect: true,
        callbackUrl,
      });
    } catch (error: unknown) {
      Sentry.captureException(error, { tags: { flow: "login-credentials" } });
      setNotice(
        "Inloggen mislukt (netwerk of server). Controleer je verbinding en probeer het opnieuw.",
      );
    }
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
            <input
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <input
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <button onClick={login}>Sign in</button>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            <a href="/reset-request">Forgot password?</a>
          </div>
          <h4 style={{ marginTop: 12 }}>Or create an account</h4>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Email"
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <input
              placeholder="Password"
              type="password"
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <input
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <input
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <input
              placeholder="Invitation code"
              value={invitationCode}
              onChange={(e) => setInvitationCode(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <button onClick={register}>Create account</button>
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <h3>Google</h3>
          <button
            type="button"
            onClick={async () => {
              setNotice(null);
              try {
                await signIn("google", { callbackUrl });
              } catch (error: unknown) {
                Sentry.captureException(error, {
                  tags: { flow: "login-google" },
                });
                setNotice(
                  "Google-inloggen mislukt (netwerk of server). Probeer het opnieuw.",
                );
              }
            }}
          >
            Inloggen met Google
          </button>
        </div>

        {notice ? (
          <div className="muted" style={{ marginTop: 10 }}>
            {notice}
          </div>
        ) : null}
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
