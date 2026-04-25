"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Card, Input, Stack } from "../../components/ui";

function Content() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [notice, setNotice] = useState<{
    tone: "info" | "error";
    text: string;
  } | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [registering, setRegistering] = useState(false);
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl") || "/";

  async function register() {
    setNotice(null);
    setRegistering(true);
    try {
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
        setNotice({ tone: "error", text: data.error || "Registratie mislukt" });
        return;
      }
      setNotice({ tone: "info", text: "Geregistreerd. Je kunt nu inloggen." });
    } finally {
      setRegistering(false);
    }
  }

  async function login() {
    setNotice(null);
    setSigningIn(true);
    try {
      await signIn("credentials", {
        email,
        password,
        redirect: true,
        callbackUrl,
      });
      // next-auth handelt navigatie af
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <main>
      <div className="container">
        <h1>Inloggen</h1>
        <div className="muted" style={{ marginTop: 6 }}>
          <a href={callbackUrl}>← Terug</a>
        </div>

        <Card style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Met Google</h3>
          <Button
            variant="primary"
            isFullWidth
            onClick={() => signIn("google", { callbackUrl })}
          >
            Inloggen met Google
          </Button>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Met e-mail</h3>
          <Stack gap="3">
            <Input
              label="E-mailadres"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Wachtwoord"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Stack direction="row" gap="2" justify="between" align="center">
              <a href="/reset-request" className="muted">
                Wachtwoord vergeten?
              </a>
              <Button
                variant="primary"
                onClick={login}
                loading={signingIn}
                loadingLabel="Inloggen…"
              >
                Inloggen
              </Button>
            </Stack>
          </Stack>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Account aanmaken</h3>
          <Stack gap="3">
            <Input
              label="E-mailadres"
              type="email"
              autoComplete="email"
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
            />
            <Input
              label="Wachtwoord"
              type="password"
              autoComplete="new-password"
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              hint="Minimaal 8 tekens"
            />
            <Stack direction="row" gap="3">
              <div style={{ flex: 1, minWidth: 0 }}>
                <Input
                  label="Voornaam"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Input
                  label="Achternaam"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </Stack>
            <Input
              label="Uitnodigingscode"
              value={invitationCode}
              onChange={(e) => setInvitationCode(e.target.value)}
              hint="Krijg je van de trainer of teammanager"
            />
            <Stack direction="row" justify="end">
              <Button
                onClick={register}
                loading={registering}
                loadingLabel="Aanmaken…"
              >
                Account aanmaken
              </Button>
            </Stack>
          </Stack>
        </Card>

        {notice ? (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            className="card"
            style={{
              marginTop: 12,
              borderColor:
                notice.tone === "error" ? "var(--negative)" : "var(--accent)",
            }}
          >
            {notice.text}
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
