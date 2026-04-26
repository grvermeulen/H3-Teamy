"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Roles = { admin?: boolean; trainer?: boolean; player?: boolean };
type UserRow = { id: string; name: string; roles: Roles };

type MatchJson = {
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number;
  awayScore?: number;
  date?: string;
  events?: Array<{
    quarter: 1 | 2 | 3 | 4;
    time?: string;
    team: "home" | "away";
    type: "goal" | "personal_foul";
    player?: string;
  }>;
};

export default function AdminUsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const [testImageFile, setTestImageFile] = useState<File | null>(null);
  const [extractedJson, setExtractedJson] = useState<MatchJson | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      const data = await res.json();
      if (!mounted) return;
      setRows((data?.users || []) as UserRow[]);
      setDirty(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  function toggle(id: string, key: keyof Roles) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, roles: { ...r.roles, [key]: !r.roles[key] } } : r,
      ),
    );
    setDirty(true);
  }

  async function onSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const items = rows.map((r) => ({ id: r.id, roles: r.roles }));
      const res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const t = await res.text();
        setSaveError(`Opslaan mislukt: ${t}`);
        return;
      }
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      // Rebuild roster cache for other pages and then reload admin list
      await fetch("/api/users?refresh=1", { cache: "no-store" }).catch(
        () => {},
      );
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setRows((data?.users || []) as UserRow[]);
        setDirty(false);
      }
    } finally {
      setRefreshing(false);
    }
  }

  const sorted = useMemo(
    () => rows.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  );

  async function onTestExtract() {
    if (!testImageFile) {
      setTestError("Kies eerst een afbeelding.");
      return;
    }
    setExtracting(true);
    setTestError(null);
    setExtractedJson(null);
    try {
      const form = new FormData();
      form.set("image", testImageFile);
      const res = await fetch("/api/report/extract", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        setTestError(`Extractie mislukt: ${text}`);
        return;
      }
      const data = await res.json();
      setExtractedJson(data?.result || null);
    } catch (e: any) {
      setTestError(`Extractiefout: ${e?.message || String(e)}`);
    } finally {
      setExtracting(false);
    }
  }

  async function onTestGenerate() {
    if (!extractedJson) {
      setTestError("Doe eerst een extractie.");
      return;
    }
    setGenerating(true);
    setTestError(null);
    setGeneratedReport(null);
    try {
      const payload = {
        eventId: "test-" + Date.now(),
        homeTeam: extractedJson.homeTeam,
        awayTeam: extractedJson.awayTeam,
        homeScore: extractedJson.homeScore,
        awayScore: extractedJson.awayScore,
        date: extractedJson.date,
        events: extractedJson.events,
      };
      const res = await fetch("/api/report/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        setTestError(`Genereren mislukt: ${text}`);
        return;
      }
      const data = await res.json();
      setGeneratedReport(data?.report?.content || null);
    } catch (e: any) {
      setTestError(`Genereerfout: ${e?.message || String(e)}`);
    } finally {
      setGenerating(false);
    }
  }

  if (forbidden)
    return (
      <div className="container">
        <h1>Admin</h1>
        <div className="muted">Je hebt geen toegang.</div>
      </div>
    );

  return (
    <main>
      <div className="container">
        <h1>Admin</h1>

        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <Link href={{ pathname: "/admin/feedback" }}>Feedback-inbox →</Link>
        </div>

        <div className="card" style={{ position: "sticky", top: 0, zIndex: 1 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div className="muted">Gebruikersrollen</div>
            <div className="row" style={{ gap: 8 }}>
              <button onClick={onRefresh} disabled={refreshing}>
                {refreshing ? "Vernieuwen…" : "Vernieuwen"}
              </button>
              <button onClick={onSave} disabled={!dirty || saving}>
                {saving ? "Opslaan…" : "Opslaan"}
              </button>
            </div>
          </div>
          {saveError ? (
            <div
              role="alert"
              className="muted"
              style={{ marginTop: 8, color: "var(--negative)" }}
            >
              {saveError}
            </div>
          ) : null}
        </div>
        <div className="list">
          {sorted.map((u) => (
            <div key={u.id} className="card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div>{u.name}</div>
                <div className="row" style={{ gap: 8 }}>
                  <label
                    className="badge"
                    style={{ cursor: "pointer", padding: "6px 10px" }}
                  >
                    <input
                      type="checkbox"
                      checked={!!u.roles.player}
                      onChange={() => toggle(u.id, "player")}
                      style={{ marginRight: 6 }}
                    />
                    Speler
                  </label>
                  <label
                    className="badge"
                    style={{ cursor: "pointer", padding: "6px 10px" }}
                  >
                    <input
                      type="checkbox"
                      checked={!!u.roles.trainer}
                      onChange={() => toggle(u.id, "trainer")}
                      style={{ marginRight: 6 }}
                    />
                    Trainer
                  </label>
                  <label
                    className="badge"
                    style={{ cursor: "pointer", padding: "6px 10px" }}
                  >
                    <input
                      type="checkbox"
                      checked={!!u.roles.admin}
                      onChange={() => toggle(u.id, "admin")}
                      style={{ marginRight: 6 }}
                    />
                    Admin
                  </label>
                </div>
              </div>
            </div>
          ))}
          {sorted.length === 0 ? (
            <div className="muted">Geen gebruikers gevonden.</div>
          ) : null}
        </div>

        <div className="card" style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0 }}>Wedstrijdverslag testen</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  setTestImageFile(e.target.files?.[0] || null);
                  setExtractedJson(null);
                  setGeneratedReport(null);
                  setTestError(null);
                }}
              />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                onClick={onTestExtract}
                disabled={!testImageFile || extracting}
              >
                {extracting ? "Extractie…" : "Test extractie"}
              </button>
              <button
                onClick={onTestGenerate}
                disabled={!extractedJson || generating}
              >
                {generating ? "Genereren…" : "Test verslag"}
              </button>
            </div>
            {testError && (
              <div
                role="alert"
                style={{
                  padding: 10,
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--negative)",
                  background:
                    "color-mix(in oklab, var(--negative) 12%, transparent)",
                  color: "var(--text)",
                }}
              >
                {testError}
              </div>
            )}
            {extractedJson && (
              <div>
                <h3>Geëxtraheerde JSON</h3>
                <pre
                  style={{
                    padding: 12,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "var(--radius-md)",
                    overflow: "auto",
                    maxHeight: 400,
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(extractedJson, null, 2)}
                </pre>
              </div>
            )}
            {generatedReport && (
              <div>
                <h3>Gegenereerd verslag</h3>
                <div
                  style={{
                    padding: 12,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "var(--radius-md)",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.6,
                  }}
                >
                  {generatedReport}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
