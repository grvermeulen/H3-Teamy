"use client";

import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { APP_VERSION } from "../lib/version";
import { isBenignTransientClientFetchError } from "../lib/benignClientFetchErrors";
import { Button, Input, Textarea } from "./ui";
import { useSession } from "./SessionContext";

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
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const { loading, loggedIn } = useSession();
  const [tab, setTab] = useState<Tab>("BUG");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading || !loggedIn) return null;
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

  async function submit(e: React.FormEvent): Promise<void> {
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
      if (!isBenignTransientClientFetchError(err)) {
        Sentry.captureException(err, { tags: { component: "feedback-fab" } });
      }
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
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4 4v-4h-.5A1.5 1.5 0 0 1 4 14.5v-9Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M8 8.5h8M8 11.5h5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
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
            <Button
              role="tab"
              aria-selected={tab === "BUG"}
              variant={tab === "BUG" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setTab("BUG")}
            >
              Bug
            </Button>
            <Button
              role="tab"
              aria-selected={tab === "IDEA"}
              variant={tab === "IDEA" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setTab("IDEA")}
            >
              Idee
            </Button>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Input
              label="Titel"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={COPY[tab].titlePh}
              maxLength={120}
              required
              minLength={3}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <Textarea
              label="Toelichting"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={COPY[tab].bodyPh}
              maxLength={4000}
              required
              minLength={5}
              rows={5}
            />
          </div>
          <div className="row justify-end gap-2">
            {notice ? (
              <span className="muted text-[13px]">{notice}</span>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              loadingLabel="Versturen…"
            >
              {COPY[tab].cta}
            </Button>
          </div>
          <div className="muted text-[11px] mt-2 text-right">
            v{APP_VERSION}
          </div>
        </form>
      </dialog>
    </>
  );
}
