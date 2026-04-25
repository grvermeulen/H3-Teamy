"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { APP_VERSION } from "../lib/version";

type Tab = "BUG" | "IDEA";

const COPY: Record<
  Tab,
  { label: string; titlePh: string; bodyPh: string; cta: string }
> = {
  BUG: {
    label: "Report a bug",
    titlePh: "Short summary (e.g. RSVP button doesn't work)",
    bodyPh: "What did you do, what happened, what did you expect?",
    cta: "Send bug report",
  },
  IDEA: {
    label: "Pitch an idea",
    titlePh: "One-line idea (e.g. Notify me 1h before training)",
    bodyPh: "Tell us the problem and how this would help.",
    cta: "Submit idea",
  },
};

export default function FeedbackFab() {
  const pathname = usePathname() || "/";
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("BUG");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        setLoggedIn(!!data?.user);
      })
      .catch(() => {
        if (!alive) return;
        setLoggedIn(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loggedIn !== true) return null;
  if (pathname.startsWith("/login")) return null;

  function open(initialTab: Tab) {
    setTab(initialTab);
    setTitle("");
    setBody("");
    setNotice(null);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: tab,
          title: title.trim(),
          body: body.trim(),
          route: pathname,
          appVersion: APP_VERSION,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNotice(data?.error || "Could not send. Please try again.");
        return;
      }
      setNotice("Thanks — we got it.");
      setTitle("");
      setBody("");
      setTimeout(() => {
        close();
        setNotice(null);
      }, 1200);
    } catch {
      setNotice("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-tour="feedback-fab"
        aria-label="Send feedback"
        onClick={() => open("BUG")}
        className="feedbackFab"
      >
        💬
      </button>
      <dialog ref={dialogRef} className="feedbackDialog">
        <form onSubmit={submit} className="card" style={{ minWidth: 280 }}>
          <div
            className="row"
            style={{ justifyContent: "space-between", marginBottom: 12 }}
          >
            <strong>Feedback</strong>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              style={{ background: "transparent", border: 0, color: "inherit" }}
            >
              ✕
            </button>
          </div>
          <div
            className="row"
            role="tablist"
            aria-label="Feedback type"
            style={{ marginBottom: 12, gap: 8 }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "BUG"}
              onClick={() => setTab("BUG")}
              className={tab === "BUG" ? "navActive" : undefined}
            >
              Bug
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "IDEA"}
              onClick={() => setTab("IDEA")}
              className={tab === "IDEA" ? "navActive" : undefined}
            >
              Idea
            </button>
          </div>
          <label style={{ display: "block", marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              Title
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={COPY[tab].titlePh}
              maxLength={120}
              required
              minLength={3}
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <label style={{ display: "block", marginBottom: 12 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              Details
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={COPY[tab].bodyPh}
              maxLength={4000}
              required
              minLength={5}
              rows={5}
              style={{ width: "100%", marginTop: 4, resize: "vertical" }}
            />
          </label>
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            {notice ? (
              <span className="muted" style={{ fontSize: 13 }}>
                {notice}
              </span>
            ) : null}
            <button type="submit" disabled={submitting}>
              {submitting ? "Sending…" : COPY[tab].cta}
            </button>
          </div>
          <div
            className="muted"
            style={{ fontSize: 11, marginTop: 8, textAlign: "right" }}
          >
            v{APP_VERSION}
          </div>
        </form>
      </dialog>
    </>
  );
}
