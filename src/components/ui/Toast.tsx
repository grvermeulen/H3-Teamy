"use client";

import { useEffect, useState } from "react";

type Tone = "info" | "success" | "error";
type Toast = {
  id: number;
  tone: Tone;
  message: string;
};

type ToastEventDetail = { tone?: Tone; message: string; durationMs?: number };

const TOAST_EVENT = "ui:toast";

let nextId = 1;

/**
 * Dispatches a toast notification anywhere in the app. Use instead of
 * `alert()`. Tone defaults to `"info"`.
 *
 * @param message - Body text to display.
 * @param tone - Optional emphasis (`info` | `success` | `error`).
 * @param durationMs - Override auto-dismiss duration (defaults to 4 s).
 */
export function showToast(
  message: string,
  tone: Tone = "info",
  durationMs?: number,
): void {
  if (typeof window === "undefined") return;
  const detail: ToastEventDetail = { tone, message, durationMs };
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }));
}

/**
 * Mounts the toast region exactly once at the app root. Listens for
 * `ui:toast` events fired by {@link showToast} and renders a stack of
 * dismissable toasts above the bottom navigation.
 */
export default function ToastRegion() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastEventDetail>).detail;
      if (!detail?.message) return;
      const id = nextId++;
      const toast: Toast = {
        id,
        tone: detail.tone ?? "info",
        message: detail.message,
      };
      setToasts((prev) => [...prev, toast]);
      const ms = detail.durationMs ?? 4000;
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, ms);
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  if (toasts.length === 0) return null;

  return (
    <div className="ui-toast-region" role="region" aria-label="Meldingen">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="ui-toast"
          data-tone={t.tone}
          role={t.tone === "error" ? "alert" : "status"}
        >
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            type="button"
            aria-label="Sluiten"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
