import { notFound } from "next/navigation";
import { getReport } from "../../../lib/kv";
import Link from "next/link";

type Params = { params: { eventId: string } };

export const revalidate = 0;

export default async function ReportPage({ params }: Params) {
  const eventId = params.eventId;
  const report = await getReport(eventId);
  if (!report) notFound();
  return (
    <main>
      <div className="container">
        <h1>Match report</h1>
        <div className="muted" style={{ marginBottom: 12 }}>Event: {eventId}</div>
        <article style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{report.content}</article>
        <div className="muted" style={{ marginTop: 12 }}>Published {new Date(report.createdAt).toLocaleString()}</div>
        <div style={{ marginTop: 16 }}><Link href="/">← Back</Link></div>
      </div>
    </main>
  );
}


