"use client";

import { useEffect, useState } from "react";

export default function GenerateReportButton({ eventId, opponent }: { eventId: string; opponent?: string }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<{ homeScore?: number; awayScore?: number } | null>(null);

  useEffect(() => {
    fetch("/api/admin/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setIsAdmin(Boolean(d?.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, []);

  async function onGenerate() {
    setLoading(true);
    try {
      let payload: any = { eventId, opponent };
      if (imageFile) {
        const form = new FormData();
        form.set("image", imageFile);
        const er = await fetch("/api/report/extract", { method: "POST", body: form });
        if (er.ok) {
          const data = await er.json();
          setExtracted(data?.result || null);
          if (data?.result?.homeScore != null && data?.result?.awayScore != null) {
            payload.scoreHome = Number(data.result.homeScore);
            payload.scoreAway = Number(data.result.awayScore);
          }
          if (data?.result?.homeTeam && data?.result?.awayTeam) {
            payload.opponent = data.result.homeTeam && String(data.result.homeTeam).includes("De Rijn") ? data.result.awayTeam : data.result.homeTeam;
          }
        }
      }
      const res = await fetch("/api/report/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const info = await res.text();
        alert(`Generation failed: ${info}`);
        return;
      }
      setDone(true);
      // Notify other components to refresh report content
      window.dispatchEvent(new CustomEvent("report:updated", { detail: { eventId } }));
    } finally {
      setLoading(false);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="rsvp" style={{ justifyContent: "flex-end", marginTop: 8, gap: 8 }}>
      <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
      <button
        onClick={onGenerate}
        disabled={loading}
        className={done ? "active-yes" : undefined}
        style={{ minWidth: 160 }}
      >
        {loading ? "Genereren…" : done ? "Gegenereerd" : "Verslag genereren"}
      </button>
    </div>
  );
}


