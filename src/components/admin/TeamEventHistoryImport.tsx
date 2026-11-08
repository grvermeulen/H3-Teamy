"use client";

import * as Sentry from "@sentry/nextjs";
import { useCallback, useState } from "react";
import { Button, Card, showToast } from "../ui";
import { TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026 } from "../../lib/knzbVerifiedH3Gap2026";

type ImportPreviewRow = {
  id: string;
  title: string;
  start: string;
  action: "create" | "update" | "unchanged";
};

type ImportResponse = {
  dryRun: boolean;
  preview: ImportPreviewRow[];
  written: number;
};

/**
 * Admin-kaart: droge run en idempotente import van ontbrekende KNZB-wedstrijden naar Postgres.
 */
export default function TeamEventHistoryImport() {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewRow[] | null>(null);
  const [lastWritten, setLastWritten] = useState<number | null>(null);

  const runImport = useCallback(async (dryRun: boolean) => {
    setLoading(true);
    setLastWritten(null);
    try {
      const res = await fetch("/api/admin/team-events/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preset: TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026,
          dryRun,
        }),
      });
      if (res.status === 403) {
        showToast("Geen admin-rechten voor wedstrijdimport.");
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(err?.message ?? `Import mislukt (${res.status})`);
      }
      const data = (await res.json()) as ImportResponse;
      setPreview(data.preview);
      if (!dryRun) {
        setLastWritten(data.written);
        showToast(
          data.written > 0
            ? `${data.written} wedstrijd(en) opgeslagen in Postgres.`
            : "Geen wijzigingen nodig (al aanwezig).",
        );
      }
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { component: "TeamEventHistoryImport" },
      });
      showToast("Wedstrijdimport mislukt. Zie console voor details.");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Ontbrekende wedstrijdgeschiedenis</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Herstelt wedstrijden die Sportlink niet meer in de iCal-feed heeft, via
        idempotente upsert naar de database. Standaard alleen een droge run.
        Bron: KNZB (okt/nov 2026 H3-gat).
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button
          type="button"
          loading={loading}
          loadingLabel="Bezig…"
          onClick={() => void runImport(true)}
        >
          Droge run (H3 okt/nov)
        </Button>
        <Button
          type="button"
          variant="primary"
          loading={loading}
          loadingLabel="Schrijven…"
          onClick={() => void runImport(false)}
        >
          Importeer naar database
        </Button>
      </div>
      {preview && preview.length > 0 ? (
        <ul style={{ marginTop: 16, paddingLeft: 20 }}>
          {preview.map((row) => (
            <li key={row.id} style={{ marginBottom: 6 }}>
              <code>{row.id}</code> — {row.title} (
              <span className="muted">{row.action}</span>)
            </li>
          ))}
        </ul>
      ) : null}
      {lastWritten !== null ? (
        <p className="muted" role="status">
          Laatste run: {lastWritten} rij(en) geschreven. Vernieuw de
          wedstrijdpagina; `/api/events` pikt Postgres automatisch op.
        </p>
      ) : null}
    </Card>
  );
}
