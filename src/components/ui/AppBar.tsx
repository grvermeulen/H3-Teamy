"use client";

import type { ReactNode } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

type AppBarProps = {
  title: string;
  fallbackHref?: Route;
  backLabel?: string;
  action?: ReactNode;
};

/** Compact, safe-area-aware header for drill-down screens. */
export default function AppBar({
  title,
  fallbackHref = "/",
  backLabel = "Terug",
  action,
}: AppBarProps) {
  const router = useRouter();

  function goBack(): void {
    let hasSameOriginReferrer = false;
    try {
      hasSameOriginReferrer =
        document.referrer.length > 0 &&
        new URL(document.referrer).origin === window.location.origin;
    } catch {
      // A malformed referrer is not safe evidence of in-app history.
    }

    if (hasSameOriginReferrer && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  return (
    <div className="ui-app-bar">
      <button
        type="button"
        className="ui-app-bar-back"
        onClick={goBack}
        aria-label={backLabel}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <h1>{title}</h1>
      <div className="ui-app-bar-action">{action}</div>
    </div>
  );
}
