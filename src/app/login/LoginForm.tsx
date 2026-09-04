"use client";

import * as Sentry from "@sentry/nextjs";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { startAuthentication } from "@simplewebauthn/browser";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { signIn } from "next-auth/react";
import { useEffect, useState, type JSX } from "react";
import { Button, Card, Input, Stack } from "../../components/ui";
import { isBenignWebAuthnClientError } from "../../lib/webAuthnClientErrors";

type LoginFormProps = {
  /** Veilig relatief redirect-pad na succesvolle login (server-gevalideerd). */
  callbackUrl: string;
};

type Notice = { tone: "info" | "error"; text: string } | null;

/**
 * Client-side login- en registratieformulier (credentials + Google) gebouwd op
 * het H3 design-systeem (Button/Card/Input/Stack). Ontvangt `callbackUrl` als
 * prop van de serverpagina zodat er geen `useSearchParams`-hydratatie-race is.
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
  const [notice, setNotice] = useState<Notice>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signingInWithGoogle, setSigningInWithGoogle] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [webAuthnUsable, setWebAuthnUsable] = useState(false);

  useEffect(() => {
    setWebAuthnUsable(
      typeof window !== "undefined" && browserSupportsWebAuthn(),
    );
  }, []);

  async function register(): Promise<void> {
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
        setNotice({
          tone: "error",
          text:
            typeof data.error === "string"
              ? data.error
              : "Registratie mislukt. Controleer de gegevens en probeer het opnieuw.",
        });
        return;
      }
      setNotice({
        tone: "info",
        text: "Account aangemaakt. Je kunt nu inloggen.",
      });
    } finally {
      setRegistering(false);
    }
  }

  async function login(): Promise<void> {
    if (signingIn) return;
    setNotice(null);
    setSigningIn(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      });
      if (result?.error) {
        setNotice({
          tone: "error",
          text: "Inloggen mislukt. Controleer e-mail en wachtwoord.",
        });
        setSigningIn(false);
        return;
      }
      // Navigeer expliciet — laat de "Inloggen…" spinner staan tijdens de redirect.
      window.location.assign(result?.url || callbackUrl);
    } catch (error: unknown) {
      Sentry.captureException(error, { tags: { flow: "login-credentials" } });
      setNotice({
        tone: "error",
        text: "Netwerkfout bij inloggen. Probeer opnieuw.",
      });
      setSigningIn(false);
    }
  }

  async function loginPasskey(): Promise<void> {
    if (passkeyLoading) return;
    setNotice(null);
    setPasskeyLoading(true);
    try {
      const optRes = await fetch("/api/auth/passkey/login-options", {
        method: "POST",
      });
      if (!optRes.ok) {
        setNotice({
          tone: "error",
          text: "Passkey-inloggen is nu niet beschikbaar. Probeer opnieuw of kies e-mail of Google.",
        });
        return;
      }
      const { optionsJSON, loginSessionId } = (await optRes.json()) as {
        optionsJSON: PublicKeyCredentialRequestOptionsJSON;
        loginSessionId: string;
      };
      const credential = await startAuthentication({ optionsJSON });
      const verRes = await fetch("/api/auth/passkey/login-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginSessionId, credential }),
      });
      const data = (await verRes.json().catch(() => ({}))) as {
        error?: string;
        exchangeToken?: string;
      };
      if (!verRes.ok) {
        setNotice({
          tone: "error",
          text:
            typeof data.error === "string"
              ? data.error
              : "Inloggen met passkey mislukt.",
        });
        return;
      }
      const exchangeToken = data.exchangeToken;
      if (!exchangeToken) {
        setNotice({
          tone: "error",
          text: "Passkey-respons onvolledig. Probeer opnieuw.",
        });
        return;
      }
      const result = await signIn("credentials", {
        passkeyExchange: exchangeToken,
        redirect: false,
        callbackUrl,
      });
      if (result?.error) {
        setNotice({
          tone: "error",
          text: "Inloggen met passkey mislukt. Probeer opnieuw of gebruik e-mail of Google.",
        });
        return;
      }
      window.location.assign(result?.url || callbackUrl);
    } catch (error: unknown) {
      if (isBenignWebAuthnClientError(error)) {
        Sentry.addBreadcrumb({
          category: "webauthn",
          message: "Passkey-prompt geannuleerd of niet toegestaan",
          level: "info",
        });
      } else {
        Sentry.captureException(error, { tags: { flow: "login-passkey" } });
      }
      setNotice({
        tone: "error",
        text: "Passkey-inloggen onderbroken of niet ondersteund op dit apparaat.",
      });
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function loginGoogle(): Promise<void> {
    if (signingInWithGoogle) return;
    setNotice(null);
    setSigningInWithGoogle(true);
    try {
      await signIn("google", { callbackUrl });
    } catch (error: unknown) {
      Sentry.captureException(error, { tags: { flow: "login-google" } });
      setNotice({
        tone: "error",
        text: "Google-inloggen mislukt (netwerk of server). Probeer het opnieuw.",
      });
      setSigningInWithGoogle(false);
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
            loading={signingInWithGoogle}
            loadingLabel="Google openen…"
            onClick={() => void loginGoogle()}
          >
            Inloggen met Google
          </Button>
        </Card>

        {webAuthnUsable ? (
          <Card style={{ marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Snel inloggen</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Gebruik Touch ID, Face ID of een vergelijkbare passkey als je die
              op je profiel hebt toegevoegd.
            </p>
            <Button
              variant="secondary"
              isFullWidth
              onClick={() => void loginPasskey()}
              loading={passkeyLoading}
              loadingLabel="Passkey…"
            >
              Inloggen met passkey
            </Button>
          </Card>
        ) : null}

        <Card style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Met e-mail</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void login();
            }}
          >
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
                  type="submit"
                  variant="primary"
                  loading={signingIn}
                  loadingLabel="Inloggen…"
                >
                  Inloggen
                </Button>
              </Stack>
            </Stack>
          </form>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Account aanmaken</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void register();
            }}
          >
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
                  type="submit"
                  loading={registering}
                  loadingLabel="Aanmaken…"
                >
                  Account aanmaken
                </Button>
              </Stack>
            </Stack>
          </form>
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
