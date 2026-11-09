"use client";

import { useSyncExternalStore } from "react";

function subscribeToNothing(): () => void {
  return () => {};
}

function readOrigin(): string {
  return window.location.origin;
}

function readServerOrigin(): null {
  return null;
}

/**
 * The site's origin (e.g. `https://h3.example`) in the browser, `null` during
 * server rendering and hydration, so links built from it never mismatch.
 */
export function useSiteOrigin(): string | null {
  return useSyncExternalStore(subscribeToNothing, readOrigin, readServerOrigin);
}
