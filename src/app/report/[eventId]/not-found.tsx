import Link from "next/link";

/**
 * Shown when /report/[eventId] has no stored report (KV miss) or the route is invalid.
 */
export default function ReportNotFound() {
  return (
    <main>
      <div className="container">
        <h1>Geen verslag gevonden</h1>
        <p style={{ color: "var(--muted)", lineHeight: 1.6, maxWidth: 520 }}>
          Voor deze wedstrijd staat er nog geen verslag in de app, of de link is
          verlopen. Een beheerder kan het verslag genereren via de wedstrijd op
          de homepage (knop &quot;Verslag genereren&quot;).
        </p>
        <p style={{ color: "var(--muted)", marginTop: 12, fontSize: "0.9rem" }}>
          Tip: open de link op dezelfde omgeving waar het verslag is gemaakt
          (productie vs. test).
        </p>
        <div style={{ marginTop: 24 }}>
          <Link href="/" className="muted" style={{ textDecoration: "underline" }}>
            ← Terug naar programma
          </Link>
        </div>
      </div>
    </main>
  );
}
