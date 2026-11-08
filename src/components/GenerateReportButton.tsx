"use client";

import { useState } from "react";
import { useSession } from "./SessionContext";
import { extractTeamsFromEventTitle } from "../lib/matchTitleTeams";
import {
  formatReportExtractClientError,
  formatReportGenerateError,
} from "../lib/reportClientErrors";
import { createReportExtractAttemptId } from "../lib/reportExtractAttemptId";
import type { ReportExtractDiagnosticResponse } from "../lib/reportExtractDiagnostics";
import {
  extractedTeamsMismatchFixture,
  extractHasScoresAndEvents,
  type ExtractedMatchResult,
} from "../lib/reportExtractValidation";
import { reportExtractSupportRef } from "../lib/reportExtractAttemptId";

export default function GenerateReportButton({
  eventId,
  opponent,
}: {
  eventId: string;
  /** Kalenderwedstrijdtitel (thuis/uit) voor fallback en mismatch-check. */
  opponent?: string;
}) {
  const { isAdmin } = useSession();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<{
    homeScore?: number;
    awayScore?: number;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onGenerate() {
    setLoading(true);
    setNotice(null);
    try {
      const titleTeams = extractTeamsFromEventTitle(opponent);
      let payload: Record<string, unknown> = { eventId };
      if (opponent) {
        payload.matchTitle = opponent;
      }
      if (imageFile) {
        const attemptId = createReportExtractAttemptId();
        const form = new FormData();
        form.set("image", imageFile);
        let er: Response;
        try {
          er = await fetch("/api/report/extract", {
            method: "POST",
            headers: { "X-Report-Extract-Attempt": attemptId },
            body: form,
          });
        } catch (error: unknown) {
          const isAbort =
            (error instanceof DOMException && error.name === "AbortError") ||
            (error instanceof Error && error.name === "AbortError");
          setNotice(
            formatReportExtractClientError({
              kind: isAbort ? "abort" : "network",
              diagnostic: {
                attemptId,
                requestId: "",
                supportRef: attemptId.replace(/-/g, "").slice(0, 8),
              },
            }),
          );
          return;
        }
        const headerRequestId =
          er.headers.get("X-Report-Extract-Request-Id") ?? "";
        const bodyText = await er.text();
        const parseBody = (): {
          result?: unknown;
          diagnostic?: ReportExtractDiagnosticResponse;
        } | null => {
          try {
            return JSON.parse(bodyText) as {
              result?: unknown;
              diagnostic?: ReportExtractDiagnosticResponse;
            };
          } catch {
            return null;
          }
        };
        if (!er.ok) {
          const parsed = parseBody();
          const diagnostic =
            parsed?.diagnostic ??
            (headerRequestId
              ? {
                  attemptId,
                  requestId: headerRequestId,
                  supportRef: reportExtractSupportRef(
                    attemptId,
                    headerRequestId,
                  ),
                }
              : {
                  attemptId,
                  requestId: "",
                  supportRef: attemptId.replace(/-/g, "").slice(0, 8),
                });
          const kind =
            parsed == null ? ("non_json" as const) : ("http" as const);
          setNotice(
            formatReportExtractClientError({
              kind,
              httpStatus: er.status,
              bodyText: parsed == null ? bodyText : JSON.stringify(parsed),
              diagnostic,
            }),
          );
          return;
        }
        const data = parseBody();
        if (!data?.result) {
          setNotice(
            formatReportExtractClientError({
              kind: "non_json",
              httpStatus: er.status,
              bodyText,
              diagnostic: data?.diagnostic ?? null,
            }),
          );
          return;
        }
        setExtracted(
          (data.result as { homeScore?: number; awayScore?: number }) || null,
        );
        const result = data.result as ExtractedMatchResult;

        if (titleTeams && extractedTeamsMismatchFixture(titleTeams, result)) {
          setNotice(
            "De gekozen screenshot lijkt niet bij deze wedstrijd te horen (andere teamnamen). Kies de screenshot van deze wedstrijd of selecteer de juiste kaart.",
          );
          return;
        }

        if (!extractHasScoresAndEvents(result)) {
          setNotice(
            "In de screenshot ontbreken een herkenbare eindstand en wedstrijdgebeurtenissen. Controleer of je de volledige KNZB/Sportlink-score hebt gekozen.",
          );
          return;
        }

        if (result.homeTeam) payload.homeTeam = result.homeTeam;
        if (result.awayTeam) payload.awayTeam = result.awayTeam;
        if (result.homeScore != null)
          payload.homeScore = Number(result.homeScore);
        if (result.awayScore != null)
          payload.awayScore = Number(result.awayScore);
        if (result.date) payload.date = result.date;
        if (result.events?.length) payload.events = result.events;
        payload.result = result;
      }

      if (!imageFile) {
        const hasScores =
          typeof payload.homeScore === "number" &&
          typeof payload.awayScore === "number";
        const hasEvents =
          Array.isArray(payload.events) && payload.events.length > 0;
        if (!hasScores || !hasEvents) {
          setNotice(
            "Ongeldige invoer: upload eerst een screenshot of zorg dat score en events zijn ingevuld.",
          );
          return;
        }
      }

      if (titleTeams) {
        if (!payload.homeTeam) payload.homeTeam = titleTeams.home;
        if (!payload.awayTeam) payload.awayTeam = titleTeams.away;
      }

      const res = await fetch("/api/report/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const info = await res.text();
        setNotice(formatReportGenerateError(res.status, info));
        return;
      }
      const data = (await res.json()) as {
        whatsappNotification?: {
          sent: boolean;
          reason?: string;
          details?: string;
        };
      };
      if (data?.whatsappNotification?.sent === false) {
        const reason = data.whatsappNotification.reason ?? "onbekend";
        const details = data.whatsappNotification.details?.trim();
        if (reason === "api_unauthenticated") {
          setNotice(
            details ??
              "Het verslag is opgeslagen, maar de WhatsApp-melding kon niet worden verzonden: het WaAPI-token is ongeldig. Werk WAAPI_API_TOKEN bij in Vercel.",
          );
        } else {
          setNotice(
            `Het verslag is opgeslagen, maar de WhatsApp-melding is niet verzonden (${reason}).${details ? ` ${details}` : ""}`,
          );
        }
      }
      setDone(true);
      window.dispatchEvent(
        new CustomEvent("report:updated", { detail: { eventId } }),
      );
    } finally {
      setLoading(false);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="event-report-row">
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setImageFile(e.target.files?.[0] || null)}
      />
      <button
        onClick={onGenerate}
        disabled={loading}
        className={done ? "active-yes" : undefined}
      >
        {loading ? "Genereren…" : done ? "Gegenereerd" : "Verslag genereren"}
      </button>
      {notice ? (
        <div role="alert" className="event-report-notice muted">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
