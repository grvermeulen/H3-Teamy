"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";

/** Holds the screen awake while visible and releases ownership on unmount. */
export function useArenaWakeLock(): boolean {
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    if (!navigator.wakeLock) return undefined;
    let disposed = false;
    let pending = false;
    let lock: WakeLockSentinel | null = null;
    const report = (error: unknown): void => {
      if (
        error instanceof DOMException &&
        ["NotAllowedError", "AbortError"].includes(error.name)
      )
        Sentry.addBreadcrumb({
          category: "arena-wake-lock",
          message: error.name,
        });
      else
        Sentry.captureException(error, {
          tags: { area: "arena", kind: "wake-lock" },
        });
    };
    const acquire = async (): Promise<void> => {
      if (disposed || pending || document.hidden || (lock && !lock.released))
        return;
      pending = true;
      try {
        const granted = await navigator.wakeLock.request("screen");
        if (disposed || document.hidden) {
          await granted.release();
          return;
        }
        lock = granted;
        setAwake(true);
        granted.addEventListener("release", () => {
          if (!disposed) setAwake(false);
        });
      } catch (error: unknown) {
        report(error);
      } finally {
        pending = false;
      }
    };
    const visible = (): void => {
      void acquire();
    };
    document.addEventListener("visibilitychange", visible);
    void acquire();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visible);
      if (lock && !lock.released) void lock.release().catch(report);
    };
  }, []);
  return awake;
}
