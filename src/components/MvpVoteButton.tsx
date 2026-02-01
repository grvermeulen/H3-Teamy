"use client";

import { useCallback, useEffect, useState } from "react";
import NextDynamic from "next/dynamic";

const MvpVotingPanel = NextDynamic(() => import("./MvpVotingPanel"), {
  ssr: false,
});

type Props = { eventId: string };

type Meta = { canClose: boolean; canReopen: boolean };

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.clone().json();
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
  } catch {
    // ignore
  }
  try {
    const text = await res.text();
    if (text) return text;
  } catch {
    // ignore
  }
  return res.statusText || "Onbekende fout";
}

export default function MvpVoteButton({ eventId }: Props) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [action, setAction] = useState<"close" | "reopen" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const res = await fetch(
        `/api/report/mvp?eventId=${encodeURIComponent(eventId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setMeta(null);
        return;
      }
      const data = await res.json();
      setMeta({
        canClose: Boolean(data?.canClose),
        canReopen: Boolean(data?.canReopen),
      });
    } catch {
      setMeta(null);
    } finally {
      setMetaLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousTouchAction = body.style.touchAction;
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    return () => {
      body.style.overflow = previousOverflow;
      body.style.touchAction = previousTouchAction;
    };
  }, [open]);

  async function handleClose() {
    setAction("close");
    setError(null);
    try {
      const res = await fetch("/api/report/mvp/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      await refreshMeta();
    } catch (err: any) {
      setError(err?.message || "Sluiten mislukt");
    } finally {
      setAction(null);
    }
  }

  async function handleReopen() {
    setAction("reopen");
    setError(null);
    try {
      const res = await fetch("/api/report/mvp/reopen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      await refreshMeta();
    } catch (err: any) {
      setError(err?.message || "Heropenen mislukt");
    } finally {
      setAction(null);
    }
  }

  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setOpen(true)}>
          Stem op MVP
        </button>
        {!metaLoading && meta?.canClose ? (
          <button
            type="button"
            onClick={handleClose}
            disabled={action === "close"}
          >
            {action === "close" ? "Sluiten…" : "Sluit MVP-stemming"}
          </button>
        ) : null}
        {!metaLoading && meta?.canReopen ? (
          <button
            type="button"
            onClick={handleReopen}
            disabled={action === "reopen"}
          >
            {action === "reopen" ? "Heropenen…" : "Heropen MVP-stemming"}
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="muted" style={{ marginTop: 4, color: "#ff7b72" }}>
          {error}
        </div>
      ) : null}
      {open ? (
        <div className="modalOverlay" onClick={() => setOpen(false)}>
          <div
            className="modalContent"
            style={{ maxWidth: 560, width: "90%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modalCloseBtn"
              onClick={() => setOpen(false)}
              aria-label="Close"
              type="button"
            >
              ×
            </button>
            <div
              style={{
                maxHeight: "70vh",
                overflowY: "auto",
                paddingRight: 8,
                marginTop: 8,
              }}
            >
              <MvpVotingPanel
                eventId={eventId}
                variant="inline"
                onStatusChange={refreshMeta}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
