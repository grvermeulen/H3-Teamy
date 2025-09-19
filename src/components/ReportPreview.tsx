"use client";

import { useEffect, useState } from "react";

export default function ReportPreview({ eventId }: { eventId: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const rep = await fetch(`/api/report?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ report: null }));
      if (!mounted) return;
      const text = rep?.report?.content ? String(rep.report.content) : null;
      setContent(text);
    }
    load();
    function onUpdated(e: any) {
      if (e?.detail?.eventId === eventId) {
        load();
      }
    }
    window.addEventListener("report:updated", onUpdated as any);
    return () => { mounted = false; window.removeEventListener("report:updated", onUpdated as any); };
  }, [eventId]);
  const hasReport = Boolean(content && content.trim());

  return (
    <>
      <div className="rsvp" style={{ justifyContent: "flex-end", marginTop: 8 }}>
        {hasReport ? (
          <button onClick={async () => {
            setOpen(true);
            // Refresh content when opening overlay
            const rep = await fetch(`/api/report?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ report: null }));
            const text = rep?.report?.content ? String(rep.report.content) : null;
            setContent(text);
          }}>Bekijk wedstrijd verslag</button>
        ) : null}
      </div>
      {open ? (
        <div className="modalOverlay" onClick={() => setOpen(false)}>
          <div className="modalContent" onClick={(e) => e.stopPropagation()}>
            <button className="modalCloseBtn" onClick={() => setOpen(false)} aria-label="Close">×</button>
            <h3 style={{ marginTop: 0, marginBottom: 10 }}>Wedstrijd verslag</h3>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{content || "Er is nog geen verslag beschikbaar."}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}


