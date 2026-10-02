"use client";

import { useState } from "react";
import { Button, Card, Input, Stack } from "../../components/ui";

type NoticeTone = "success" | "info" | "error";
type Notice = { tone: NoticeTone; title?: string; text: string } | null;

function noticeBorderColor(tone: NoticeTone): string {
  if (tone === "success") return "var(--positive)";
  if (tone === "error") return "var(--negative)";
  return "var(--accent)";
}

function noticeBackground(tone: NoticeTone): string | undefined {
  if (tone === "success") {
    return "color-mix(in oklab, var(--positive) 14%, transparent)";
  }
  if (tone === "error") {
    return "color-mix(in oklab, var(--negative) 12%, transparent)";
  }
  return undefined;
}

export default function ResetRequestPage() {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setNotice(null);
    setDevToken(null);
    setSubmitting(true);
    try {
      const trimmedEmail = email.trim();
      const res = await fetch("/api/auth/password/reset-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      if (res.ok) {
        const data = await res.json().catch(
          () =>
            ({}) as {
              token?: string;
              suppressed?: boolean;
              sent?: boolean;
            },
        );
        if (data?.sent) {
          setNotice({
            tone: "success",
            title: "Resetlink verstuurd",
            text: `We hebben een e-mail gestuurd naar ${trimmedEmail}. Open de link in die mail om je wachtwoord te wijzigen. De link is 60 minuten geldig. Controleer ook je spamfolder.`,
          });
        } else if (data?.suppressed) {
          setNotice({
            tone: "info",
            title: "Er is al een actieve resetlink",
            text: "Je hebt recent al een resetlink aangevraagd. Controleer je e-mail (ook spam). Die link blijft 60 minuten geldig. Daarna kun je een nieuwe link aanvragen.",
          });
        } else {
          setNotice({
            tone: "info",
            text: "Als dit e-mailadres bij ons bekend is, sturen we een resetlink. Controleer je inbox en spamfolder.",
          });
        }
        if (data?.token) setDevToken(data.token);
      } else {
        setNotice({
          tone: "error",
          title: "Versturen mislukt",
          text: "Het versturen van de resetlink is mislukt. Probeer het later opnieuw.",
        });
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
                disabled={!email.trim()}
              >
                Resetlink versturen
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
              borderColor: noticeBorderColor(notice.tone),
              background: noticeBackground(notice.tone),
            }}
          >
            {notice.title ? (
              <div style={{ fontWeight: 600 }}>{notice.title}</div>
            ) : null}
            <p className="muted" style={{ marginTop: notice.title ? 8 : 0 }}>
              {notice.text}
            </p>
          </div>
        ) : null}

        {devToken ? (
          <div className="muted" style={{ marginTop: 12 }}>
            Dev-token:{" "}
            <a href={`/reset/${encodeURIComponent(devToken)}`}>{devToken}</a>
          </div>
        ) : null}
      </div>
    </main>
  );
}
