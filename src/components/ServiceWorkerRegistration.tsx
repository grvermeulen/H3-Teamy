"use client";

import { useEffect } from "react";
import { setupServiceWorker } from "../lib/serviceWorkerRegistration";

/**
 * Mounts the service worker policy for this build: production builds register `public/sw.js`,
 * every other build removes leftover workers so `next dev` never runs stale chunks. Renders nothing.
 */
export default function ServiceWorkerRegistration(): null {
  useEffect(() => setupServiceWorker(process.env.NODE_ENV), []);
  return null;
}
