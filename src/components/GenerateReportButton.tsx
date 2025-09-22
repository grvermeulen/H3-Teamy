"use client";

import { useEffect, useState } from "react";

export default function GenerateReportButton({ eventId, opponent }: { eventId: string; opponent?: string }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<{ homeScore?: number; awayScore?: number } | null>(null);

  useEffect(() => {
    async function checkAdmin() {
      try {
        const adminRes = await fetch("/api/admin/status", { cache: "no-store" });
        const adminData = await adminRes.json();
        setIsAdmin(Boolean(adminData?.isAdmin));
      } catch {
        setIsAdmin(false);
      }
    }
    checkAdmin();
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
          const result = data?.result;
          
          // Basic match data
          if (result?.homeScore != null && result?.awayScore != null) {
            payload.scoreHome = Number(result.homeScore);
            payload.scoreAway = Number(result.awayScore);
          }
          if (result?.homeTeam && result?.awayTeam) {
            payload.opponent = result.homeTeam && String(result.homeTeam).includes("De Rijn") ? result.awayTeam : result.homeTeam;
          }
          
          // Additional match details for richer reports
          if (result?.venue) payload.venue = result.venue;
          if (result?.scorers?.length) payload.scorers = result.scorers;
          if (result?.mvp) payload.mvp = result.mvp;
          if (result?.periods?.length) payload.periods = result.periods;
          if (result?.highlights?.length) payload.highlights = result.highlights;
          if (result?.events?.length) payload.events = result.events;
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
    <div className="rsvp" style={{ justifyContent: "flex-end", marginTop: 8, gap: 8, flexWrap: "wrap" }}>
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


