"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import type { ChangelogEntry, TourStep } from "../lib/changelog";
import { isBenignTransientClientFetchError } from "../lib/benignClientFetchErrors";
import { fetchJsonOr } from "../lib/safeClientJson";

type Spotlight = {
  top: number;
  left: number;
  width: number;
  height: number;
} | null;

function spotlightFor(target: string | undefined): Spotlight {
  if (!target || typeof window === "undefined") return null;
  const el = document.querySelector(target) as HTMLElement | null;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const pad = 8;
  return {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

/**
 * Client-side overlay that walks a logged-in user through the changes in the
 * current `APP_VERSION` once. On mount it asks `/api/whats-new` whether the
 * tour should run; if so it renders a stepper, drawing a fixed-position
 * spotlight box around each step's `target` selector. Dismiss / "Done"
 * acknowledges the version via `POST /api/whats-new/ack`. The initial fetch is
 * not aborted on unmount: some browsers report cancellation as
 * `TypeError: Failed to fetch`, which would otherwise be sent to Sentry as a
 * false positive; state updates after unmount are skipped via a flag instead.
 */
export default function WhatsNewTour(): React.JSX.Element | null {
  const [entry, setEntry] = useState<ChangelogEntry | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [spotlight, setSpotlight] = useState<Spotlight>(null);

  useEffect(() => {
    let alive = true;
    type WhatsNewResponse = {
      show: boolean;
      version: string;
      payload?: ChangelogEntry;
    };
    const empty: WhatsNewResponse = { show: false, version: "" };
    void (async () => {
      const data = await fetchJsonOr<WhatsNewResponse>(
        "/api/whats-new",
        { cache: "no-store" },
        empty,
        "whats-new-tour",
      );
      if (!alive) return;
      if (data.show && data.payload) {
        setEntry(data.payload);
        setVersion(data.version);
        setStepIdx(0);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const step: TourStep | null = entry?.steps[stepIdx] ?? null;

  useEffect(() => {
    if (!step) return;
    setSpotlight(spotlightFor(step.target));
    function onResize(): void {
      setSpotlight(spotlightFor(step?.target));
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [step]);

  if (!entry || !step) return null;

  async function dismiss(): Promise<void> {
    setEntry(null);
    try {
      await fetch("/api/whats-new/ack", { method: "POST" });
    } catch (err: unknown) {
      if (!isBenignTransientClientFetchError(err)) {
        Sentry.captureException(err, { tags: { component: "whats-new-tour" } });
      }
    }
  }

  function next(): void {
    if (!entry) return;
    if (stepIdx < entry.steps.length - 1) {
      setStepIdx(stepIdx + 1);
    } else {
      void dismiss();
    }
  }

  const isLast = stepIdx === entry.steps.length - 1;

  return (
    <>
      {spotlight ? (
        <div
          className="whatsNewSpotlight"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
          }}
        />
      ) : null}
      <div className="whatsNewBackdrop" role="dialog" aria-modal="true">
        <div className="card whatsNewCard">
          <div className="row justify-between mb-2">
            <strong>{entry.title}</strong>
            <button
              type="button"
              onClick={() => void dismiss()}
              aria-label="Sluit rondleiding"
              className="bg-transparent border-0 text-inherit"
            >
              ✕
            </button>
          </div>
          <h3 className="my-2">{step.title}</h3>
          <p>{step.body}</p>
          <div className="row justify-between mt-4 items-center">
            <span className="muted text-xs">
              v{version} · {stepIdx + 1} / {entry.steps.length}
            </span>
            <div className="row gap-2">
              <button type="button" onClick={() => void dismiss()}>
                Overslaan
              </button>
              <button type="button" onClick={next}>
                {isLast ? "Klaar" : "Volgende"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
