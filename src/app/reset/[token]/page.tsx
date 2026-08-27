"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Input, Stack } from "../../../components/ui";

export default function ResetWithTokenPage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token as string) || "";
  const router = useRouter();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [notice, setNotice] = useState<{
    tone: "info" | "error";
    text: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setNotice(null);
    if (p1 !== p2 || p1.length < 8) {
      setNotice({
        tone: "error",
        text: "Wachtwoorden moeten gelijk zijn en minimaal 8 tekens lang.",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password/reset-confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword: p1 }),
      });
      if (res.ok) {
        setNotice({
          tone: "info",
          text: "Wachtwoord bijgewerkt. Je wordt doorgestuurd…",
        });
        setTimeout(() => router.push("/login"), 1000);
      } else {
        const data = await res.json().catch(() => ({}) as { error?: string });
        const errorKey = data?.error || "unknown";
        const messages: Record<string, string> = {
          invalid_or_expired:
            "De resetlink is verlopen of al gebruikt. Vraag via inloggen een nieuwe link aan (wachtwoord vergeten).",
          invalid:
            "Ongeldige invoer. Gebruik minimaal 8 tekens en controleer dat beide wachtwoorden gelijk zijn.",
          db_unavailable:
            "De server is tijdelijk niet bereikbaar. Probeer het later opnieuw.",
        };
        setNotice({
          tone: "error",
          text: messages[errorKey] ?? "Reset mislukt. Vraag een nieuwe link aan.",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <div className="container">
        <h1>Nieuw wachtwoord kiezen</h1>
        <Card style={{ marginTop: 12 }}>
          <Stack gap="3">
            <Input
              label="Nieuw wachtwoord"
              type="password"
              autoComplete="new-password"
              value={p1}
              onChange={(e) => setP1(e.target.value)}
              hint="Minimaal 8 tekens"
            />
            <Input
              label="Bevestig wachtwoord"
              type="password"
              autoComplete="new-password"
              value={p2}
              onChange={(e) => setP2(e.target.value)}
            />
            <Stack direction="row" justify="end">
              <Button
                variant="primary"
                onClick={submit}
                loading={submitting}
                loadingLabel="Bijwerken…"
              >
                Wachtwoord bijwerken
              </Button>
            </Stack>
            {notice ? (
              <div
                role={notice.tone === "error" ? "alert" : "status"}
                className="muted"
                style={{
                  color:
                    notice.tone === "error" ? "var(--negative)" : undefined,
                }}
              >
                {notice.text}
              </div>
            ) : null}
          </Stack>
        </Card>
      </div>
    </main>
  );
}
