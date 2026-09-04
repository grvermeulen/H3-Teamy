"use client";

import { useEffect, useMemo, useState } from "react";
import AdminNav from "../../components/AdminNav";
import {
  Button,
  Card,
  EmptyState,
  Input,
  showToast,
} from "../../components/ui";

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

type ExtractMeta = {
  providerUsed?: string;
  model?: string;
  fallbackUsed?: boolean;
};

async function apiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    message?: string;
    info?: string;
  } | null;
  return payload?.info || payload?.message || fallback;
}

export default function AdminUsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [testImageFile, setTestImageFile] = useState<File | null>(null);
  const [extractedJson, setExtractedJson] = useState<MatchJson | null>(null);
  const [extractMeta, setExtractMeta] = useState<ExtractMeta | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch("/api/admin/users", { cache: "no-store" });
        if (!mounted) return;
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        if (!res.ok) throw new Error(`users request failed: ${res.status}`);
        const data = await res.json();
        if (!mounted) return;
        setRows((data?.users || []) as UserRow[]);
        setDirty(false);
      } catch {
        if (mounted) setLoadError("Gebruikers laden mislukt.");
      } finally {
        if (mounted) setLoading(false);
      }
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
      showToast("Gebruikersrollen opgeslagen", "success");
    } catch {
      setSaveError("Opslaan mislukt. Controleer je verbinding.");
    } finally {
      setSaving(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    setLoadError(null);
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
        showToast("Gebruikers vernieuwd", "success");
      } else {
        setLoadError("Gebruikers vernieuwen mislukt.");
      }
    } catch {
      setLoadError("Gebruikers vernieuwen mislukt.");
    } finally {
      setRefreshing(false);
    }
  }

  const sorted = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("nl-NL");
    return rows
      .filter((row) => row.name.toLocaleLowerCase("nl-NL").includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [query, rows]);

  async function onTestExtract() {
    if (!testImageFile) {
      setTestError("Kies eerst een afbeelding.");
      return;
    }
    setExtracting(true);
    setTestError(null);
    setExtractedJson(null);
    setExtractMeta(null);
    try {
      const form = new FormData();
      form.set("image", testImageFile);
      const res = await fetch("/api/report/extract", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        setTestError(
          `Extractie mislukt: ${await apiErrorMessage(res, "onbekende fout")}`,
        );
        return;
      }
      const data = await res.json();
      setExtractedJson(data?.result || null);
      setExtractMeta(data?.meta || null);
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

        <AdminNav />

        <Input
          label="Zoek gebruiker"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Naam"
        />

        <div className="card" style={{ position: "sticky", top: 0, zIndex: 1 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div className="muted">
              {loading ? "Gebruikers laden…" : `${sorted.length} gebruikers`}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Button
                onClick={onRefresh}
                disabled={dirty}
                loading={refreshing}
                loadingLabel="Vernieuwen…"
                size="sm"
                title={dirty ? "Sla wijzigingen eerst op" : undefined}
              >
                Vernieuwen
              </Button>
              <Button
                onClick={onSave}
                disabled={!dirty}
                loading={saving}
                loadingLabel="Opslaan…"
                size="sm"
                variant="primary"
              >
                Opslaan
              </Button>
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
          {loadError ? (
            <div
              role="alert"
              style={{ marginTop: 8, color: "var(--negative)" }}
            >
              {loadError}
            </div>
          ) : null}
        </div>
        <div className="list" aria-busy={loading || undefined}>
          {loading
            ? Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="card skeleton"
                  style={{ height: 76 }}
                />
              ))
            : sorted.map((u) => (
                <div key={u.id} className="card">
                  <div
                    className="admin-user-row"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div>{u.name}</div>
                    <div className="admin-role-row">
                      <label className="badge admin-role-toggle">
                        <input
                          type="checkbox"
                          checked={!!u.roles.player}
                          onChange={() => toggle(u.id, "player")}
                          aria-label={`Speler voor ${u.name}`}
                        />
                        Speler
                      </label>
                      <label className="badge admin-role-toggle">
                        <input
                          type="checkbox"
                          checked={!!u.roles.trainer}
                          onChange={() => toggle(u.id, "trainer")}
                          aria-label={`Trainer voor ${u.name}`}
                        />
                        Trainer
                      </label>
                      <label className="badge admin-role-toggle">
                        <input
                          type="checkbox"
                          checked={!!u.roles.admin}
                          onChange={() => toggle(u.id, "admin")}
                          aria-label={`Admin voor ${u.name}`}
                        />
                        Admin
                      </label>
                    </div>
                  </div>
                </div>
              ))}
          {!loading && sorted.length === 0 ? (
            <EmptyState
              title={query ? "Geen gebruikers gevonden" : "Nog geen gebruikers"}
              body={
                query
                  ? "Pas je zoekopdracht aan."
                  : "Vernieuw om het opnieuw te proberen."
              }
              action={
                loadError ? (
                  <Button onClick={onRefresh}>Opnieuw proberen</Button>
                ) : undefined
              }
            />
          ) : null}
        </div>

        <Card style={{ marginTop: 24 }}>
          <details>
            <summary className="admin-tool-summary">
              Wedstrijdverslag testen
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    setTestImageFile(e.target.files?.[0] || null);
                    setExtractedJson(null);
                    setExtractMeta(null);
                    setGeneratedReport(null);
                    setTestError(null);
                  }}
                />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Button
                  onClick={onTestExtract}
                  disabled={!testImageFile}
                  loading={extracting}
                  loadingLabel="Extractie…"
                >
                  Test extractie
                </Button>
                <Button
                  onClick={onTestGenerate}
                  disabled={!extractedJson}
                  loading={generating}
                  loadingLabel="Genereren…"
                >
                  Test verslag
                </Button>
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
                  {extractMeta?.model ? (
                    <p className="muted" role="status">
                      Verwerkt met {extractMeta.model}
                      {extractMeta.fallbackUsed ? " (fallback)" : ""}
                    </p>
                  ) : null}
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
          </details>
        </Card>
      </div>
    </main>
  );
}
