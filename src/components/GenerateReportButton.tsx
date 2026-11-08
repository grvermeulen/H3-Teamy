"use client";

import { useState } from "react";
import { useSession } from "./SessionContext";
import { extractTeamsFromEventTitle } from "../lib/matchTitleTeams";
import { formatReportGenerateError } from "../lib/reportClientErrors";
import {
  extractedTeamsMismatchFixture,
  extractHasScoresAndEvents,
} from "../lib/reportExtractValidation";

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
        const form = new FormData();
        form.set("image", imageFile);
        const er = await fetch("/api/report/extract", {
          method: "POST",
          body: form,
        });
        if (!er.ok) {
          setNotice(
            "Screenshot kon niet worden gelezen. Probeer een scherpere foto of een andere export.",
          );
          return;
        }
        const data = await er.json();
        setExtracted(data?.result || null);
        const result = data?.result;

        if (titleTeams && result && extractedTeamsMismatchFixture(titleTeams, result)) {
          setNotice(
            "De gekozen screenshot lijkt niet bij deze wedstrijd te horen (andere teamnamen). Kies de screenshot van deze wedstrijd of selecteer de juiste kaart.",
          );
          return;
        }

        if (!result || !extractHasScoresAndEvents(result)) {
          setNotice(
            "In de screenshot ontbreken een herkenbare eindstand en wedstrijdgebeurtenissen. Controleer of je de volledige KNZB/Sportlink-score hebt gekozen.",
          );
          return;
        }

        if (result.homeTeam) payload.homeTeam = result.homeTeam;
        if (result.awayTeam) payload.awayTeam = result.awayTeam;
        if (result.homeScore != null) payload.homeScore = Number(result.homeScore);
        if (result.awayScore != null) payload.awayScore = Number(result.awayScore);
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
    <div
      className="rsvp"
      style={{
        justifyContent: "flex-end",
        marginTop: 8,
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setImageFile(e.target.files?.[0] || null)}
        style={{ maxWidth: "100%", minWidth: 0, flex: "1 1 auto" }}
      />
      <button
        onClick={onGenerate}
        disabled={loading}
        className={done ? "active-yes" : undefined}
        style={{ minWidth: 160 }}
      >
        {loading ? "Genereren…" : done ? "Gegenereerd" : "Verslag genereren"}
      </button>
      {notice ? (
        <div
          role="alert"
          className="muted"
          style={{ flexBasis: "100%", marginTop: 4, color: "var(--negative)" }}
        >
          {notice}
        </div>
      ) : null}
    </div>
  );
}
