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
    try {
      const items = rows.map((r) => ({ id: r.id, roles: r.roles }));
      const res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const t = await res.text();
        alert(`Save failed: ${t}`);
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
      setTestError("Please select an image file first");
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
        setTestError(`Extract failed: ${text}`);
        return;
      }
      const data = await res.json();
      setExtractedJson(data?.result || null);
    } catch (e: any) {
      setTestError(`Extract error: ${e?.message || String(e)}`);
    } finally {
      setExtracting(false);
    }
  }

  async function onTestGenerate() {
    if (!extractedJson) {
      setTestError("Please extract JSON first");
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
        setTestError(`Generate failed: ${text}`);
        return;
      }
      const data = await res.json();
      setGeneratedReport(data?.report?.content || null);
    } catch (e: any) {
      setTestError(`Generate error: ${e?.message || String(e)}`);
    } finally {
      setGenerating(false);
    }
  }

  if (forbidden)
    return (
      <div className="container">
        <h1>Admin</h1>
        <div className="muted">You do not have access.</div>
      </div>
    );

  return (
    <main>
      <div className="container">
        <h1>Admin</h1>

        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <Link href={{ pathname: "/admin/feedback" }}>Feedback inbox →</Link>
        </div>

        <div className="card" style={{ position: "sticky", top: 0, zIndex: 1 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div className="muted">User roles</div>
            <div className="row" style={{ gap: 8 }}>
              <button onClick={onRefresh} disabled={refreshing}>
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
              <button onClick={onSave} disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
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
                  <label className="badge" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!u.roles.player}
                      onChange={() => toggle(u.id, "player")}
                    />{" "}
                    Player
                  </label>
                  <label className="badge" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!u.roles.trainer}
                      onChange={() => toggle(u.id, "trainer")}
                    />{" "}
                    Trainer
                  </label>
                  <label className="badge" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!u.roles.admin}
                      onChange={() => toggle(u.id, "admin")}
                    />{" "}
                    Admin
                  </label>
                </div>
              </div>
            </div>
          ))}
          {sorted.length === 0 ? (
            <div className="muted">No users found.</div>
          ) : null}
        </div>

        <div className="card" style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0 }}>Match Report Testing</h2>
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
                {extracting ? "Extracting…" : "Test Extract"}
              </button>
              <button
                onClick={onTestGenerate}
                disabled={!extractedJson || generating}
              >
                {generating ? "Generating…" : "Test Generate"}
              </button>
            </div>
            {testError && (
              <div
                style={{
                  color: "red",
                  padding: 8,
                  backgroundColor: "#ffe0e0",
                  borderRadius: 4,
                }}
              >
                {testError}
              </div>
            )}
            {extractedJson && (
              <div>
                <h3>Extracted JSON:</h3>
                <pre
                  style={{
                    padding: 12,
                    backgroundColor: "#f5f5f5",
                    borderRadius: 4,
                    overflow: "auto",
                    maxHeight: "400px",
                    fontSize: "12px",
                  }}
                >
                  {JSON.stringify(extractedJson, null, 2)}
                </pre>
              </div>
            )}
            {generatedReport && (
              <div>
                <h3>Generated Report:</h3>
                <div
                  style={{
                    padding: 12,
                    backgroundColor: "#f5f5f5",
                    borderRadius: 4,
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
