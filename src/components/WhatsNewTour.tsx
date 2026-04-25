"use client";

import { useEffect, useState } from "react";
import type { ChangelogEntry, TourStep } from "../lib/changelog";

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

export default function WhatsNewTour() {
  const [entry, setEntry] = useState<ChangelogEntry | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [spotlight, setSpotlight] = useState<Spotlight>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/whats-new", { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (data: {
          show: boolean;
          version: string;
          payload?: ChangelogEntry;
        }) => {
          if (!alive) return;
          if (data.show && data.payload) {
            setEntry(data.payload);
            setVersion(data.version);
            setStepIdx(0);
          }
        },
      )
      .catch(() => {
        /* silent — tour is optional */
      });
    return () => {
      alive = false;
    };
  }, []);

  const step: TourStep | null = entry?.steps[stepIdx] ?? null;

  useEffect(() => {
    if (!step) return;
    setSpotlight(spotlightFor(step.target));
    function onResize() {
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

  async function dismiss() {
    setEntry(null);
    try {
      await fetch("/api/whats-new/ack", { method: "POST" });
    } catch {
      /* ack is best-effort */
    }
  }

  function next() {
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
          <div
            className="row"
            style={{ justifyContent: "space-between", marginBottom: 8 }}
          >
            <strong>{entry.title}</strong>
            <button
              type="button"
              onClick={() => void dismiss()}
              aria-label="Close tour"
              style={{ background: "transparent", border: 0, color: "inherit" }}
            >
              ✕
            </button>
          </div>
          <h3 style={{ margin: "8px 0" }}>{step.title}</h3>
          <p>{step.body}</p>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              marginTop: 16,
              alignItems: "center",
            }}
          >
            <span className="muted" style={{ fontSize: 12 }}>
              v{version} · {stepIdx + 1} / {entry.steps.length}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" onClick={() => void dismiss()}>
                Skip
              </button>
              <button type="button" onClick={next}>
                {isLast ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
