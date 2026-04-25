"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type FeedbackRow = {
  id: string;
  type: "BUG" | "IDEA";
  status: "NEW" | "TRIAGED" | "PLANNED" | "SHIPPED" | "DECLINED";
  title: string;
  body: string;
  route: string | null;
  appVersion: string | null;
  aiTheme: string | null;
  aiImpact: string | null;
  aiSummary: string | null;
  createdAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
  };
};

const STATUSES: FeedbackRow["status"][] = [
  "NEW",
  "TRIAGED",
  "PLANNED",
  "SHIPPED",
  "DECLINED",
];

export default function AdminFeedbackPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<"ALL" | "BUG" | "IDEA">("ALL");
  const [filterStatus, setFilterStatus] = useState<
    "ALL" | FeedbackRow["status"]
  >("ALL");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterType !== "ALL") params.set("type", filterType);
    if (filterStatus !== "ALL") params.set("status", filterStatus);
    const res = await fetch(`/api/admin/feedback?${params.toString()}`, {
      cache: "no-store",
    });
    if (res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const data = await res.json().catch(() => ({ items: [] }));
    setRows((data?.items || []) as FeedbackRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterStatus]);

  async function updateStatus(id: string, status: FeedbackRow["status"]) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    await fetch(`/api/admin/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  const counts = useMemo(() => {
    const c = { BUG: 0, IDEA: 0 } as Record<"BUG" | "IDEA", number>;
    for (const r of rows) c[r.type]++;
    return c;
  }, [rows]);

  if (forbidden) {
    return (
      <main className="container">
        <h1>Forbidden</h1>
        <p className="muted">You need admin access to view this page.</p>
        <Link href="/">Back home</Link>
      </main>
    );
  }

  return (
    <main className="container" style={{ paddingBottom: 96 }}>
      <h1>Feedback</h1>
      <p className="muted">
        {counts.BUG} bug{counts.BUG === 1 ? "" : "s"} • {counts.IDEA} idea
        {counts.IDEA === 1 ? "" : "s"}
      </p>

      <div className="row" style={{ gap: 12, marginBottom: 16 }}>
        <label>
          <span className="muted" style={{ fontSize: 12, marginRight: 6 }}>
            Type
          </span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as typeof filterType)}
          >
            <option value="ALL">All</option>
            <option value="BUG">Bugs</option>
            <option value="IDEA">Ideas</option>
          </select>
        </label>
        <label>
          <span className="muted" style={{ fontSize: 12, marginRight: 6 }}>
            Status
          </span>
          <select
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as typeof filterStatus)
            }
          >
            <option value="ALL">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No feedback yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
          {rows.map((r) => (
            <li key={r.id} className="card">
              <div
                className="row"
                style={{ justifyContent: "space-between", marginBottom: 6 }}
              >
                <strong>
                  <span className="badge" style={{ marginRight: 8 }}>
                    {r.type}
                  </span>
                  {r.title}
                </strong>
                <select
                  value={r.status}
                  onChange={(e) =>
                    updateStatus(r.id, e.target.value as FeedbackRow["status"])
                  }
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <p style={{ whiteSpace: "pre-wrap", margin: "8px 0" }}>
                {r.body}
              </p>
              {r.aiSummary ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  <strong>AI PM:</strong> {r.aiSummary}
                  {r.aiTheme ? ` · theme: ${r.aiTheme}` : ""}
                  {r.aiImpact ? ` · impact: ${r.aiImpact}` : ""}
                </div>
              ) : null}
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {r.user.firstName} {r.user.lastName}
                {r.user.email ? ` · ${r.user.email}` : ""} ·{" "}
                {new Date(r.createdAt).toLocaleString()}
                {r.route ? ` · on ${r.route}` : ""}
                {r.appVersion ? ` · v${r.appVersion}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
