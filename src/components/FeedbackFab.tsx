"use client";

import { usePathname } from "next/navigation";
import * as React from "react";
import * as Sentry from "@sentry/nextjs";
import { APP_VERSION } from "../lib/version";

type Tab = "BUG" | "IDEA";

const COPY: Record<
  Tab,
  { label: string; titlePh: string; bodyPh: string; cta: string }
> = {
  BUG: {
    label: "Meld een bug",
    titlePh: "Korte samenvatting (bv. RSVP-knop werkt niet)",
    bodyPh: "Wat deed je, wat gebeurde er, wat verwachtte je?",
    cta: "Verstuur bugmelding",
  },
  IDEA: {
    label: "Tip een idee",
    titlePh: "Idee in één zin (bv. Stuur 1 uur voor training een herinnering)",
    bodyPh: "Beschrijf het probleem en hoe dit zou helpen.",
    cta: "Verstuur idee",
  },
};

/**
 * Floating action button that opens a modal dialog where the logged-in user
 * can submit a Bug or Idea. Captures the current route, `APP_VERSION`, and
 * user-agent server-side. Rendered globally from the root layout; hidden for
 * anonymous users and on the `/login` route.
 */
export default function FeedbackFab(): React.JSX.Element | null {
  const pathname = usePathname() || "/";
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const [loggedIn, setLoggedIn] = React.useState<boolean | null>(null);
  const [tab, setTab] = React.useState<Tab>("BUG");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        setLoggedIn(!!data?.user);
      })
      .catch((err: unknown) => {
        Sentry.captureException(err, { tags: { component: "feedback-fab" } });
        if (!alive) return;
        setLoggedIn(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loggedIn !== true) return null;
  if (pathname.startsWith("/login")) return null;

  function open(initialTab: Tab): void {
    setTab(initialTab);
    setTitle("");
    setBody("");
    setNotice(null);
    dialogRef.current?.showModal();
  }

  function close(): void {
    dialogRef.current?.close();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
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
        Sentry.captureException(
          new Error(`feedback POST failed: ${res.status}`),
          { tags: { component: "feedback-fab" } },
        );
        setNotice(data?.error || "Versturen mislukt. Probeer het opnieuw.");
        return;
      }
      setNotice("Bedankt — we hebben je bericht ontvangen.");
      setTitle("");
      setBody("");
      setTimeout(() => {
        close();
        setNotice(null);
      }, 1200);
    } catch (err: unknown) {
      Sentry.captureException(err, { tags: { component: "feedback-fab" } });
      setNotice("Netwerkfout. Probeer het opnieuw.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-tour="feedback-fab"
        aria-label="Stuur feedback"
        onClick={() => open("BUG")}
        className="feedbackFab"
      >
        💬
      </button>
      <dialog ref={dialogRef} className="feedbackDialog">
        <form onSubmit={submit} className="card min-w-[280px]">
          <div className="row justify-between mb-3">
            <strong>Feedback</strong>
            <button
              type="button"
              onClick={close}
              aria-label="Sluiten"
              className="bg-transparent border-0 text-inherit"
            >
              ✕
            </button>
          </div>
          <div
            className="row mb-3 gap-2"
            role="tablist"
            aria-label="Type feedback"
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
              Idee
            </button>
          </div>
          <label className="block mb-2">
            <span className="muted text-xs">Titel</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={COPY[tab].titlePh}
              maxLength={120}
              required
              minLength={3}
              className="w-full mt-1"
            />
          </label>
          <label className="block mb-3">
            <span className="muted text-xs">Toelichting</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={COPY[tab].bodyPh}
              maxLength={4000}
              required
              minLength={5}
              rows={5}
              className="w-full mt-1 resize-y"
            />
          </label>
          <div className="row justify-end gap-2">
            {notice ? (
              <span className="muted text-[13px]">{notice}</span>
            ) : null}
            <button type="submit" disabled={submitting}>
              {submitting ? "Versturen…" : COPY[tab].cta}
            </button>
          </div>
          <div className="muted text-[11px] mt-2 text-right">
            v{APP_VERSION}
          </div>
        </form>
      </dialog>
    </>
  );
}
