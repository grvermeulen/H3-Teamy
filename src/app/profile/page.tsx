"use client";
import * as Sentry from "@sentry/nextjs";
import {
  browserSupportsWebAuthn,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import { getBadgeForAttendance, type AttendanceBadge } from "../../lib/badges";
import { APP_VERSION } from "../../lib/version";
import { Button, Card, Input, Stack, showToast } from "../../components/ui";

type Profile = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
} | null;
type PasskeyRow = { id: string; createdAt: string; label: string | null };
type Roles = { admin: boolean; trainer: boolean; player: boolean };

export default function ProfilePage() {
  const [, setProfile] = useState<Profile>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [needsLink, setNeedsLink] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [roles, setRoles] = useState<Roles>({
    admin: false,
    trainer: false,
    player: true,
  });
  const [attendanceStats, setAttendanceStats] = useState<{
    attended: number;
    total: number;
    pct: number;
  } | null>(null);
  const [attendanceBadge, setAttendanceBadge] =
    useState<AttendanceBadge | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [passkeyAdding, setPasskeyAdding] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);

  async function load() {
    const [p, s, a, t, season, pkRes] = await Promise.all([
      fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/identity/status", { cache: "no-store" }).then((r) =>
        r.json(),
      ),
      fetch("/api/admin/status", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ isAdmin: false })),
      fetch("/api/trainer/status", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ isTrainer: false })),
      fetch("/api/training/overview", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ list: [], total: 0 })),
      fetch("/api/auth/passkeys", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { passkeys: [] }))
        .catch(() => ({ passkeys: [] })),
    ]);
    setProfile(p.user);
    if (p.user) {
      setFirstName(p.user.firstName || "");
      setLastName(p.user.lastName || "");
      setEmail(p.user.email || "");
    }
    setNeedsLink(!!s.needsLink);
    setRoles({ admin: !!a?.isAdmin, trainer: !!t?.isTrainer, player: true });

    if (p?.user?.id && Array.isArray(season?.list)) {
      const mine = season.list.find((row: any) => row?.userId === p.user.id);
      if (mine) {
        const attended = Number.isFinite(mine.attended) ? mine.attended : 0;
        const totalTrainings = Number.isFinite(mine.total)
          ? mine.total
          : Number.isFinite(season?.total)
            ? season.total
            : 0;
        const pct = Number.isFinite(mine.pct)
          ? mine.pct
          : totalTrainings
            ? Math.round((attended / totalTrainings) * 100)
            : 0;
        setAttendanceStats({ attended, total: totalTrainings, pct });
        setAttendanceBadge(getBadgeForAttendance(pct));
      } else {
        setAttendanceStats(null);
        setAttendanceBadge(null);
      }
    } else {
      setAttendanceStats(null);
      setAttendanceBadge(null);
    }

    const pkParsed = pkRes as { passkeys?: PasskeyRow[] };
    setPasskeys(
      Array.isArray(pkParsed.passkeys) ? pkParsed.passkeys : [],
    );
  }

  useEffect(() => {
    setPasskeySupported(
      typeof window !== "undefined" && browserSupportsWebAuthn(),
    );
  }, []);

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setEmailError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email }),
      });
      if (res.status === 409) {
        setEmailError("Dit e-mailadres is al in gebruik.");
        return;
      }
      if (!res.ok) throw new Error(`Opslaan mislukt (${res.status})`);
      showToast("Profiel opgeslagen", "success");
      await load();
    } catch (e: any) {
      showToast(e?.message || "Kon niet opslaan", "error");
    } finally {
      setSaving(false);
    }
  }

  async function adopt() {
    setAdopting(true);
    try {
      const res = await fetch("/api/identity/adopt", { method: "POST" });
      if (!res.ok) throw new Error(`Importeren mislukt (${res.status})`);
      setNeedsLink(false);
      await load();
      showToast("RSVP's van dit apparaat geïmporteerd", "success");
    } catch (e: any) {
      showToast(e?.message || "Kon niet importeren", "error");
    } finally {
      setAdopting(false);
    }
  }

  async function addPasskey(): Promise<void> {
    if (!browserSupportsWebAuthn()) {
      showToast(
        "Passkeys worden niet ondersteund in deze browser.",
        "error",
      );
      return;
    }
    setPasskeyAdding(true);
    try {
      const optRes = await fetch("/api/auth/passkey/register-options", {
        method: "POST",
      });
      if (!optRes.ok) {
        showToast(
          "Passkey starten mislukt. Probeer het later opnieuw.",
          "error",
        );
        return;
      }
      const { optionsJSON } = (await optRes.json()) as {
        optionsJSON: PublicKeyCredentialCreationOptionsJSON;
      };
      const credential = await startRegistration({ optionsJSON });
      const verRes = await fetch("/api/auth/passkey/register-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const errBody = (await verRes.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!verRes.ok) {
        showToast(
          typeof errBody.error === "string"
            ? errBody.error
            : "Passkey toevoegen mislukt.",
          "error",
        );
        return;
      }
      showToast("Passkey toegevoegd", "success");
      await load();
    } catch (error: unknown) {
      Sentry.captureException(error, { tags: { flow: "profile-passkey-add" } });
      showToast("Passkey toevoegen onderbroken.", "error");
    } finally {
      setPasskeyAdding(false);
    }
  }

  async function removePasskey(id: string): Promise<void> {
    try {
      const res = await fetch(
        `/api/auth/passkeys?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        showToast("Passkey verwijderen mislukt.", "error");
        return;
      }
      showToast("Passkey verwijderd", "success");
      await load();
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { flow: "profile-passkey-remove" },
      });
      showToast("Kon passkey niet verwijderen.", "error");
    }
  }

  const rolesLabel = [
    roles.admin ? "Admin" : null,
    roles.trainer ? "Trainer" : null,
    roles.player ? "Speler" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main>
      <div className="container">
        <h1>Mijn profiel</h1>

        {needsLink ? (
          <Card
            style={{
              maxWidth: 520,
              marginBottom: 12,
              borderColor: "var(--accent)",
            }}
          >
            <Stack direction="row" justify="between" align="center" gap="3">
              <div className="muted">
                We zagen RSVP&apos;s op dit apparaat. Wil je ze importeren in je
                account?
              </div>
              <Button
                variant="primary"
                onClick={adopt}
                loading={adopting}
                loadingLabel="Importeren…"
              >
                Importeren
              </Button>
            </Stack>
          </Card>
        ) : null}

        <Card style={{ maxWidth: 520 }}>
          <Stack gap="3">
            <Stack direction="row" gap="2" align="center">
              <span className="badge">Rollen</span>
              <span className="muted">{rolesLabel || "Speler"}</span>
            </Stack>

            <Stack direction="row" gap="2" align="center">
              <span className="badge">Opkomst</span>
              {attendanceBadge ? (
                <>
                  <span className={`badge badge-${attendanceBadge.slug}`}>
                    {attendanceBadge.label}
                  </span>
                  {attendanceStats ? (
                    <span className="muted">
                      {attendanceStats.attended}/{attendanceStats.total} (
                      {attendanceStats.pct}%)
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="muted">Nog geen data</span>
              )}
            </Stack>

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
              label="E-mailadres"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={emailError ?? undefined}
            />

            <Stack direction="row" justify="end">
              <Button
                variant="primary"
                onClick={save}
                loading={saving}
                loadingLabel="Opslaan…"
              >
                Opslaan
              </Button>
            </Stack>
          </Stack>
        </Card>

        {passkeySupported ? (
          <div data-tour="profile-passkeys">
            <Card style={{ maxWidth: 520, marginTop: 12 }}>
            <Stack gap="3">
              <div>
                <h3 style={{ marginTop: 0 }}>Snel inloggen</h3>
                <p className="muted" style={{ marginTop: 6 }}>
                  Voeg een passkey toe voor dit apparaat (Touch ID, Face ID,
                  Windows Hello of vergelijkbaar). Je blijft ook gewoon met
                  Google of e-mail kunnen inloggen.
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => void addPasskey()}
                loading={passkeyAdding}
                loadingLabel="Bezig…"
              >
                Passkey op dit apparaat toevoegen
              </Button>
              {passkeys.length > 0 ? (
                <Stack gap="2">
                  <span className="muted">Geregistreerde passkeys</span>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {passkeys.map((pk) => (
                      <li key={pk.id} style={{ marginBottom: 8 }}>
                        <Stack
                          direction="row"
                          justify="between"
                          align="center"
                          gap="2"
                        >
                          <span>
                            {pk.label ??
                              `Passkey · ${new Date(pk.createdAt).toLocaleDateString("nl-NL")}`}
                          </span>
                          <Button
                            variant="ghost"
                            onClick={() => void removePasskey(pk.id)}
                          >
                            Verwijderen
                          </Button>
                        </Stack>
                      </li>
                    ))}
                  </ul>
                </Stack>
              ) : (
                <span className="muted">Nog geen passkeys.</span>
              )}
            </Stack>
          </Card>
          </div>
        ) : null}

        <div
          data-tour="profile-version"
          className="muted"
          style={{ marginTop: 16, fontSize: 12, textAlign: "center" }}
        >
          App-versie {APP_VERSION}
        </div>
      </div>
    </main>
  );
}
