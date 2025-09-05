"use client";

import { useEffect, useState } from "react";

export default function ReportPreview({ eventId }: { eventId: string }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    // Fetch login status and report in parallel
    Promise.all([
      fetch("/api/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ user: null })),
      fetch(`/api/report?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ report: null })),
    ]).then(([me, rep]) => {
      if (!mounted) return;
      setLoggedIn(Boolean(me?.user?.id));
      const text = rep?.report?.content ? String(rep.report.content) : null;
      setContent(text);
    });
    return () => { mounted = false; };
  }, [eventId]);

  if (!loggedIn) return null;

  const hasReport = Boolean(content && content.trim());
  if (!hasReport) return null;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button onClick={() => setOpen(true)}>Bekijk wedstrijd verslag</button>
      </div>
      {open ? (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#0B1220",
              color: "#E6EDF7",
              borderRadius: 10,
              padding: 16,
              maxWidth: 600,
              width: "90%",
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
              position: "relative",
            }}
          >
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "#111926",
                color: "#E6EDF7",
                border: "1px solid #293241",
                borderRadius: 6,
                padding: "4px 8px",
              }}
            >
              ×
            </button>
            <h3 style={{ marginTop: 0, marginBottom: 10 }}>Wedstrijd verslag</h3>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{content || "Er is nog geen verslag beschikbaar."}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}


