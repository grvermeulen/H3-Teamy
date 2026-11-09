"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "./SessionContext";
import MatchReportShareLink from "./MatchReportShareLink";
import { extractTeamsFromEventTitle } from "../lib/matchTitleTeams";
import {
  formatReportExtractClientError,
  formatReportGenerateError,
} from "../lib/reportClientErrors";
import {
  createReportExtractAttemptId,
  reportExtractSupportRef,
} from "../lib/reportExtractAttemptId";
import { REPORT_FLOW_ID_HEADER } from "../lib/reportFlowCorrelation";
import { logReportFlowClientTrace } from "../lib/reportFlowClientTrace";
import type { ReportExtractDiagnosticResponse } from "../lib/reportExtractDiagnostics";
import {
  extractedTeamsMismatchFixture,
  extractHasScoresAndEvents,
  type ExtractedMatchResult,
} from "../lib/reportExtractValidation";
import {
  formatMaterializeScreenshotError,
  materializeScreenshotUploadFile,
} from "../lib/reportScreenshotUploadFile";

type GeneratedMatch = {
  opponentTeam?: string;
  ourScore?: number;
  opponentScore?: number;
};

export default function GenerateReportButton({
  eventId,
  opponent,
}: {
  eventId: string;
  /** Kalenderwedstrijdtitel (thuis/uit) voor mismatch-check. */
  opponent?: string;
}) {
  const { isAdmin } = useSession();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [generatedMatch, setGeneratedMatch] = useState<GeneratedMatch | null>(
    null,
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageMaterializing, setImageMaterializing] = useState(false);
  const [extracted, setExtracted] = useState<{
    homeScore?: number;
    awayScore?: number;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const materializeGeneration = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  /** Correlatie voor materialisatie vóór klik op genereren; hergebruikt als flowId bij submit. */
  const selectionFlowIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  async function onImageSelected(file: File | undefined) {
    materializeGeneration.current += 1;
    const generation = materializeGeneration.current;
    abortControllerRef.current?.abort();
    if (!file) {
      selectionFlowIdRef.current = null;
      setImageFile(null);
      setImageMaterializing(false);
      setNotice(null);
      return;
    }

    const selectionFlowId = createReportExtractAttemptId();
    selectionFlowIdRef.current = selectionFlowId;
    logReportFlowClientTrace({
      flowId: selectionFlowId,
      phase: "materialize_start",
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setImageMaterializing(true);
    setImageFile(null);
    setNotice(null);
    setDone(false);

    const result = await materializeScreenshotUploadFile(file, {
      signal: controller.signal,
    });

    if (generation !== materializeGeneration.current) {
      return;
    }
    setImageMaterializing(false);

    if (!result.ok) {
      if (result.errorClass === "read_aborted") {
        return;
      }
      logReportFlowClientTrace({
        flowId: selectionFlowId,
        phase: "materialize_fail",
        outcome: "error",
        materializeErrorClass: result.errorClass,
      });
      setNotice(formatMaterializeScreenshotError(result.errorClass));
      return;
    }
    logReportFlowClientTrace({
      flowId: selectionFlowId,
      phase: "materialize_ok",
      outcome: "success",
    });
    setImageFile(result.file);
  }

  async function onGenerate() {
    if (imageMaterializing) {
      return;
    }
    setLoading(true);
    setNotice(null);
    const flowId = selectionFlowIdRef.current ?? createReportExtractAttemptId();
    logReportFlowClientTrace({
      flowId,
      phase: "flow_start",
      outcome: "success",
    });
    try {
      const titleTeams = extractTeamsFromEventTitle(opponent);
      let payload: Record<string, unknown> = { eventId, reportFlowId: flowId };
      if (opponent) {
        payload.matchTitle = opponent;
      }
      if (imageFile) {
        const attemptId = flowId;
        const form = new FormData();
        form.set("extractAttemptId", attemptId);
        form.set("image", imageFile);
        logReportFlowClientTrace({
          flowId,
          phase: "extract_request_start",
        });
        let er: Response;
        try {
          er = await fetch("/api/report/extract", {
            method: "POST",
            headers: {
              "X-Report-Extract-Attempt": attemptId,
              [REPORT_FLOW_ID_HEADER]: flowId,
            },
            body: form,
          });
        } catch (error: unknown) {
          const isAbort =
            (error instanceof DOMException && error.name === "AbortError") ||
            (error instanceof Error && error.name === "AbortError");
          logReportFlowClientTrace({
            flowId,
            phase: "extract_request_fail",
            outcome: "error",
            networkKind: isAbort ? "abort" : "network",
          });
          setNotice(
            formatReportExtractClientError({
              kind: isAbort ? "abort" : "network",
              diagnostic: {
                attemptId,
                flowId,
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
          logReportFlowClientTrace({
            flowId,
            phase: "extract_request_fail",
            outcome: "error",
            httpStatus: er.status,
          });
          const parsed = parseBody();
          const diagnostic =
            parsed?.diagnostic ??
            (headerRequestId
              ? {
                  attemptId,
                  flowId,
                  requestId: headerRequestId,
                  supportRef: reportExtractSupportRef(
                    attemptId,
                    headerRequestId,
                  ),
                }
              : {
                  attemptId,
                  flowId,
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
          logReportFlowClientTrace({
            flowId,
            phase: "extract_request_fail",
            outcome: "error",
            httpStatus: er.status,
            errorClass: "missing_result",
          });
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
        logReportFlowClientTrace({
          flowId,
          phase: "extract_request_ok",
          outcome: "success",
          httpStatus: er.status,
        });
        setExtracted(
          (data.result as { homeScore?: number; awayScore?: number }) || null,
        );
        const result = data.result as ExtractedMatchResult;

        if (titleTeams && extractedTeamsMismatchFixture(titleTeams, result)) {
          logReportFlowClientTrace({
            flowId,
            phase: "extract_validation_fail",
            outcome: "error",
            extractValidationReason: "team_mismatch",
          });
          setNotice(
            "De gekozen screenshot lijkt niet bij deze wedstrijd te horen (andere teamnamen). Kies de screenshot van deze wedstrijd of selecteer de juiste kaart.",
          );
          return;
        }

        if (!extractHasScoresAndEvents(result)) {
          logReportFlowClientTrace({
            flowId,
            phase: "extract_validation_fail",
            outcome: "error",
            extractValidationReason: "incomplete_scores_events",
          });
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

      logReportFlowClientTrace({
        flowId,
        phase: "generate_request_start",
      });
      const res = await fetch("/api/report/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [REPORT_FLOW_ID_HEADER]: flowId,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        logReportFlowClientTrace({
          flowId,
          phase: "generate_request_fail",
          outcome: "error",
          httpStatus: res.status,
        });
        const info = await res.text();
        setNotice(formatReportGenerateError(res.status, info));
        return;
      }
      logReportFlowClientTrace({
        flowId,
        phase: "generate_request_ok",
        outcome: "success",
        httpStatus: res.status,
      });
      const data = (await res.json()) as { match?: GeneratedMatch } | null;
      setGeneratedMatch(data?.match ?? {});
      logReportFlowClientTrace({
        flowId,
        phase: "flow_completed",
        outcome: "success",
      });
      setDone(true);
      window.dispatchEvent(
        new CustomEvent("report:updated", { detail: { eventId } }),
      );
    } finally {
      setLoading(false);
    }
  }

  if (!isAdmin) return null;

  const buttonDisabled = loading || imageMaterializing;

  return (
    <div className="event-report-row">
      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          void onImageSelected(e.target.files?.[0]);
        }}
      />
      <button
        onClick={() => {
          void onGenerate();
        }}
        disabled={buttonDisabled}
        className={done ? "active-yes" : undefined}
      >
        {imageMaterializing
          ? "Afbeelding laden…"
          : loading
            ? "Genereren…"
            : done
              ? "Gegenereerd"
              : "Verslag genereren"}
      </button>
      {done && generatedMatch ? (
        <MatchReportShareLink
          eventId={eventId}
          opponentTeam={generatedMatch.opponentTeam}
          ourScore={generatedMatch.ourScore}
          opponentScore={generatedMatch.opponentScore}
          variant="primary"
        />
      ) : null}
      {notice ? (
        <div role="alert" className="event-report-notice muted">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
