"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import AdminNav from "../../../components/AdminNav";
import { AppBar, Button, EmptyState, showToast } from "../../../components/ui";

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

const STATUS_NL: Record<FeedbackRow["status"], string> = {
  NEW: "Nieuw",
  TRIAGED: "Getriaged",
  PLANNED: "Gepland",
  SHIPPED: "Geleverd",
  DECLINED: "Afgewezen",
};

const TYPE_NL: Record<FeedbackRow["type"], string> = {
  BUG: "Bug",
  IDEA: "Idee",
};

/**
 * Admin inbox for user-submitted feedback. Lists rows from
 * `GET /api/admin/feedback`, supports filtering by type and status, and lets
 * an admin update a row's status inline via `PATCH /api/admin/feedback/:id`.
 * Non-admin viewers are short-circuited to a "Forbidden" message via the 403
 * response from the listing endpoint.
 */
export default function AdminFeedbackPage(): React.JSX.Element {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"ALL" | "BUG" | "IDEA">("ALL");
  const [filterStatus, setFilterStatus] = useState<
    "ALL" | FeedbackRow["status"]
  >("ALL");
  const filterStatusRef = useRef(filterStatus);
  filterStatusRef.current = filterStatus;
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filterType !== "ALL") params.set("type", filterType);
    if (filterStatus !== "ALL") params.set("status", filterStatus);
    try {
      const res = await fetch(`/api/admin/feedback?${params.toString()}`, {
        cache: "no-store",
      });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error(`feedback request failed: ${res.status}`);
      const data = await res.json().catch(() => ({ items: [] }));
      setRows((data?.items || []) as FeedbackRow[]);
    } catch (err: unknown) {
      Sentry.captureException(err, { tags: { component: "admin-feedback" } });
      setError("Laden mislukt. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterStatus]);

  async function updateStatus(
    id: string,
    status: FeedbackRow["status"],
  ): Promise<void> {
    const previous = rows.find((r) => r.id === id)?.status ?? "NEW";
    setUpdatingIds((current) => new Set(current).add(id));
    setError(null);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        Sentry.captureException(
          new Error(`feedback PATCH failed: ${res.status}`),
          { tags: { component: "admin-feedback" } },
        );
        setRows((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: previous } : r)),
        );
        setError("Status bijwerken mislukt.");
      } else {
        const currentFilterStatus = filterStatusRef.current;
        if (currentFilterStatus !== "ALL" && status !== currentFilterStatus) {
          setRows((current) => current.filter((row) => row.id !== id));
        }
        showToast("Feedbackstatus bijgewerkt", "success");
      }
    } catch (err: unknown) {
      Sentry.captureException(err, { tags: { component: "admin-feedback" } });
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: previous } : r)),
      );
      setError("Status bijwerken mislukt.");
    } finally {
      setUpdatingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  const counts = useMemo(() => {
    const c = { BUG: 0, IDEA: 0 } as Record<"BUG" | "IDEA", number>;
    for (const r of rows) c[r.type]++;
    return c;
  }, [rows]);

  if (forbidden) {
    return (
      <main className="container">
        <AppBar title="Geen toegang" fallbackHref="/admin" />
        <p className="muted">
          Je hebt admin-rechten nodig om deze pagina te zien.
        </p>
      </main>
    );
  }

  return (
    <main className="container pb-24">
      <AppBar title="Feedback" fallbackHref="/admin" />
      <AdminNav />
      <p className="muted">
        {counts.BUG} {counts.BUG === 1 ? "bug" : "bugs"} • {counts.IDEA}{" "}
        {counts.IDEA === 1 ? "idee" : "ideeën"}
      </p>

      <div className="admin-filter-row">
        <label>
          <span className="muted text-xs mr-1">Type</span>
          <select
            className="ui-select"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as typeof filterType)}
          >
            <option value="ALL">Alle</option>
            <option value="BUG">Bugs</option>
            <option value="IDEA">Ideeën</option>
          </select>
        </label>
        <label>
          <span className="muted text-xs mr-1">Status</span>
          <select
            className="ui-select"
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as typeof filterStatus)
            }
          >
            <option value="ALL">Alle</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_NL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div role="alert" className="row" style={{ marginBottom: 12 }}>
          <span style={{ color: "var(--negative)" }}>{error}</span>
          <Button size="sm" onClick={() => void load()}>
            Opnieuw proberen
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="list" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card skeleton" style={{ height: 80 }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Geen feedback gevonden"
          body={
            filterType === "ALL" && filterStatus === "ALL"
              ? "Zodra spelers iets indienen verschijnt het hier."
              : "Pas de filters aan om meer resultaten te zien."
          }
          action={
            filterType !== "ALL" || filterStatus !== "ALL" ? (
              <Button
                size="sm"
                onClick={() => {
                  setFilterType("ALL");
                  setFilterStatus("ALL");
                }}
              >
                Filters wissen
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="list-none p-0 grid gap-3">
          {rows.map((r) => (
            <li key={r.id} className="card">
              <div className="admin-feedback-header">
                <strong>
                  <span className="badge mr-2">{TYPE_NL[r.type]}</span>
                  {r.title}
                </strong>
                <select
                  className="ui-select"
                  value={r.status}
                  disabled={updatingIds.has(r.id)}
                  aria-label={`Status van ${r.title}`}
                  onChange={(e) =>
                    void updateStatus(
                      r.id,
                      e.target.value as FeedbackRow["status"],
                    )
                  }
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_NL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <p className="whitespace-pre-wrap my-2">{r.body}</p>
              {r.aiSummary ? (
                <div className="muted text-[13px]">
                  <strong>AI PM:</strong> {r.aiSummary}
                  {r.aiTheme ? ` · thema: ${r.aiTheme}` : ""}
                  {r.aiImpact ? ` · impact: ${r.aiImpact}` : ""}
                </div>
              ) : null}
              <div className="muted text-xs mt-2">
                {r.user.firstName} {r.user.lastName}
                {r.user.email ? ` · ${r.user.email}` : ""} ·{" "}
                {new Date(r.createdAt).toLocaleString("nl-NL")}
                {r.route ? ` · op ${r.route}` : ""}
                {r.appVersion ? ` · v${r.appVersion}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
