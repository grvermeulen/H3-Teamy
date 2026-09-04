"use client";

import { useEffect, useState } from "react";
import { Card } from "./ui";
import { fetchJsonIfOkOr } from "../lib/safeClientJson";

type Nudge = { tone: "encourage" | "cheer"; message: string };
type Response = { nudge: Nudge | null };

/**
 * Top-of-page attendance nudge. Fetches `/api/training/nudge`; renders a warm
 * encouragement when the player's 14-day attendance is under 50% and a cheer
 * when they were at every training. Mid-range players see nothing.
 *
 * Logged-out and mid-range players get `nudge: null` from the API and this
 * component renders nothing.
 */
export default function AttendanceNudge(): React.JSX.Element | null {
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const data = await fetchJsonIfOkOr<Response>(
        "/api/training/nudge",
        { cache: "no-store" },
        "attendance-nudge",
      );
      if (!mounted) return;
      setNudge(data?.nudge ?? null);
      setLoaded(true);
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  if (!loaded || !nudge) return null;

  const accent =
    nudge.tone === "cheer" ? "var(--accent)" : "var(--accent, #2563eb)";

  return (
    <Card
      style={{
        marginBottom: 12,
        borderColor: accent,
      }}
    >
      <div
        role="status"
        aria-live="polite"
        data-testid={`attendance-nudge-${nudge.tone}`}
      >
        <div
          style={{
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            color: "var(--muted)",
            marginBottom: 4,
          }}
        >
          {nudge.tone === "cheer" ? "Top!" : "Hee 👋"}
        </div>
        <div>{nudge.message}</div>
      </div>
    </Card>
  );
}
