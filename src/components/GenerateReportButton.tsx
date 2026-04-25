"use client";

import { useState } from "react";
import { useSession } from "./SessionContext";

export default function GenerateReportButton({
  eventId,
  opponent,
}: {
  eventId: string;
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
      let payload: any = { eventId };
      if (imageFile) {
        const form = new FormData();
        form.set("image", imageFile);
        const er = await fetch("/api/report/extract", {
          method: "POST",
          body: form,
        });
        if (er.ok) {
          const data = await er.json();
          setExtracted(data?.result || null);
          const result = data?.result;

          // Basic match data passed straight through
          if (result?.homeTeam) payload.homeTeam = result.homeTeam;
          if (result?.awayTeam) payload.awayTeam = result.awayTeam;
          if (result?.homeScore != null)
            payload.homeScore = Number(result.homeScore);
          if (result?.awayScore != null)
            payload.awayScore = Number(result.awayScore);
          if (result?.date) payload.date = result.date;

          if (result?.events?.length) payload.events = result.events;
          // Pass the full normalized result as well for server-side merging
          if (result) payload.result = result;
        }
      }

      // If no image was provided, ensure we have at least minimal structured input
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
      const res = await fetch("/api/report/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const info = await res.text();
        setNotice(`Genereren mislukt: ${info}`);
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
        const details = data.whatsappNotification.details
          ? ` ${data.whatsappNotification.details}`
          : "";
        setNotice(
          `Het verslag is opgeslagen, maar de WhatsApp-melding is niet verzonden (${reason}).${details ? ` ${details}` : ""}`,
        );
      }
      setDone(true);
      // Notify other components to refresh report content
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
