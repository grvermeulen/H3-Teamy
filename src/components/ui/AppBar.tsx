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
    router.replace(fallbackHref);
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
