"use client";

import * as Sentry from "@sentry/nextjs";
import { signIn } from "next-auth/react";
import { useState, type JSX } from "react";

type LoginFormProps = {
  /** Veilig relatief redirect-pad na succesvolle login (server-gevalideerd). */
  callbackUrl: string;
};

/**
 * Client-side login- en registratieformulier (credentials + Google).
 * Ontvangt `callbackUrl` van de serverpagina zodat er geen `useSearchParams`-hydratatie-race is.
 */
export default function LoginForm({
  callbackUrl,
}: LoginFormProps): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  async function register(): Promise<void> {
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
      setNotice(
        typeof data.error === "string"
          ? data.error
          : "Registratie mislukt. Controleer de gegevens en probeer het opnieuw.",
      );
      return;
    }
    setNotice("Account aangemaakt. Je kunt nu inloggen.");
  }

  async function login(): Promise<void> {
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
        <h1>Inloggen</h1>
        <div className="muted" style={{ marginTop: 6 }}>
          <a href={callbackUrl}>Terug</a>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <h3>E-mail en wachtwoord</h3>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <input
              placeholder="Wachtwoord"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <button type="button" onClick={() => void login()}>
              Inloggen
            </button>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            <a href="/reset-request">Wachtwoord vergeten?</a>
          </div>
          <h4 style={{ marginTop: 12 }}>Of maak een account</h4>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="E-mail"
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <input
              placeholder="Wachtwoord"
              type="password"
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <input
              placeholder="Voornaam"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <input
              placeholder="Achternaam"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <input
              placeholder="Uitnodigingscode"
              value={invitationCode}
              onChange={(e) => setInvitationCode(e.target.value)}
              style={{ padding: 6, borderRadius: 6 }}
            />
            <button type="button" onClick={() => void register()}>
              Account aanmaken
            </button>
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
