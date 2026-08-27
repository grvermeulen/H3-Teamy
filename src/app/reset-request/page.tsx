"use client";

import { useState } from "react";
import { Button, Card, Input, Stack } from "../../components/ui";

export default function ResetRequestPage() {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setNotice(null);
    setDevToken(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password/reset-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}) as {
          token?: string;
          suppressed?: boolean;
        });
        const msg = data?.suppressed
          ? "Er is al een actieve resetlink (60 minuten geldig). Controleer je e-mail, ook spam. Je kunt daarna opnieuw een link aanvragen."
          : "Als dit e-mailadres bekend is, hebben we een resetlink gestuurd.";
        setNotice(msg);
        if (data?.token) setDevToken(data.token);
      } else {
        setNotice(
          "Als dit e-mailadres bekend is, hebben we een resetlink gestuurd.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <div className="container">
        <h1>Wachtwoord resetten</h1>
        <Card style={{ marginTop: 12 }}>
          <Stack gap="3">
            <Input
              label="E-mailadres"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Stack direction="row" justify="end">
              <Button
                variant="primary"
                onClick={submit}
                loading={submitting}
                loadingLabel="Versturen…"
              >
                Resetlink versturen
              </Button>
            </Stack>
            {notice ? (
              <div role="status" className="muted">
                {notice}
              </div>
            ) : null}
            {devToken ? (
              <div className="muted">
                Dev-token:{" "}
                <a href={`/reset/${encodeURIComponent(devToken)}`}>
                  {devToken}
                </a>
              </div>
            ) : null}
          </Stack>
        </Card>
      </div>
    </main>
  );
}
