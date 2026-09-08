"use client";

import { useEffect, useRef, useState } from "react";

/** How long the toast stays up. */
export const HOST_TOAST_MS = 4000;

/** Props for {@link HostToast}. */
export type HostToastProps = {
  /** The elected host, or null while nobody is. */
  hostClientId: string | null;
  /** What that host is called, or null when the crew does not name them yet. */
  hostName: string | null;
};

/**
 * "Nieuwe host: Bram" (spec §6.6, copy in §16): shown for a few seconds when the room re-elects.
 *
 * The first host is not news — the lobby already names them — so only a change announces. A host
 * who merely changed their name is not a new host either.
 *
 * @param props - The elected host and their name.
 * @returns The toast, or nothing when there is nothing new to say.
 */
export function HostToast({
  hostClientId,
  hostName,
}: HostToastProps): React.JSX.Element | null {
  const previous = useRef<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = hostClientId;
    if (!hostClientId || before === null || before === hostClientId)
      return undefined;
    setShown(hostName ?? "Onbekend");
    const timer = setTimeout(() => setShown(null), HOST_TOAST_MS);
    return () => clearTimeout(timer);
  }, [hostClientId, hostName]);
  if (!shown) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="arena-label border-b border-[var(--arena-amber)] bg-[var(--arena-amber-dim)] px-3 py-2 text-center text-[var(--arena-amber)]"
    >
      Nieuwe host: {shown}
    </div>
  );
}
