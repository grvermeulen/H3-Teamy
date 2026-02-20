"use client";

import { useEffect, useState } from "react";
import { lockBodyForModal } from "../lib/modalLock";

/**
 * Displays a "View Match Report" button if a report exists for the event.
 * Clicking the button opens a modal with the report content.
 * Listens for "report:updated" window events to refresh data.
 *
 * @param props.eventId - The ID of the event to fetch the report for.
 */
export default function ReportPreview({ eventId }: { eventId: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const rep = await fetch(
        `/api/report?eventId=${encodeURIComponent(eventId)}`,
        { cache: "no-store" },
      )
        .then((r) => r.json())
        .catch(() => ({ report: null }));
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
    return () => {
      mounted = false;
      window.removeEventListener("report:updated", onUpdated as any);
    };
  }, [eventId]);
  const hasReport = Boolean(content && content.trim());

  useEffect(() => {
    if (!open) return;
    return lockBodyForModal();
  }, [open]);

  return (
    <>
      {hasReport ? (
        <button
          type="button"
          onClick={async () => {
            setOpen(true);
            // Refresh content when opening overlay
            const rep = await fetch(
              `/api/report?eventId=${encodeURIComponent(eventId)}`,
              { cache: "no-store" },
            )
              .then((r) => r.json())
              .catch(() => ({ report: null }));
            const text = rep?.report?.content
              ? String(rep.report.content)
              : null;
            setContent(text);
          }}
        >
          Bekijk wedstrijd verslag
        </button>
      ) : null}
      {open ? (
        <div className="modalOverlay" onClick={() => setOpen(false)}>
          <div className="modalContent" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h3 className="modalTitle">Wedstrijd verslag</h3>
              <button
                className="modalCloseBtn"
                onClick={() => setOpen(false)}
                aria-label="Close"
                type="button"
              >
                ×
              </button>
            </div>
            <div className="modalBody">
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                {content || "Er is nog geen verslag beschikbaar."}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
