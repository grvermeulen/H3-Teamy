"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function ReportLink({ eventId }: { eventId: string }) {
  const [hasReport, setHasReport] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/report?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (mounted) setHasReport(Boolean(d?.report?.content)); })
      .catch(() => {});
    return () => { mounted = false; };
  }, [eventId]);

  if (!hasReport) return null;

  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
      <Link href={`/report/${encodeURIComponent(eventId)}`} className="muted" style={{ textDecoration: "underline" }}>
        Match report
      </Link>
    </div>
  );
}
