"use client";

import { useEffect, useState } from "react";

export default function GenerateReportButton({ eventId, opponent }: { eventId: string; opponent?: string }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/admin/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setIsAdmin(Boolean(d?.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, []);

  async function onGenerate() {
    setLoading(true);
    try {
      const res = await fetch("/api/report/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, opponent }),
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
    <div className="rsvp" style={{ justifyContent: "flex-end", marginTop: 8 }}>
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


