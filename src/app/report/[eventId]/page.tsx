import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getReport } from "../../../lib/kv";
import { buildMatchReportMetadata } from "../../../lib/reportShareMetadata";
import MatchReportShareLink from "../../../components/MatchReportShareLink";
import MvpVotingPanel from "../../../components/MvpVotingPanel";
import { AppBar } from "../../../components/ui";

type Params = {
  params: Promise<{ eventId: string }> | { eventId: string };
};

export const revalidate = 0;

const loadReport = cache(getReport);

/**
 * Title and preview text for a shared report link (e.g. WhatsApp's link card);
 * empty when the report does not exist, so the site defaults apply.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { eventId } = await Promise.resolve(params);
  const report = await loadReport(eventId);
  return report ? buildMatchReportMetadata(report.content) : {};
}

/** Public match report page with MVP result, WhatsApp share link and MVP voting. */
export default async function ReportPage({ params }: Params) {
  const { eventId } = await Promise.resolve(params);
  const report = await loadReport(eventId);
  if (!report) notFound();
  return (
    <main>
      <div className="container">
        <AppBar title="Wedstrijdverslag" />
        <div className="muted" style={{ marginBottom: 12 }}>
          Wedstrijd: {eventId}
        </div>
        <article style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
          {report.content}
        </article>
        {report.mvpResult ? (
          <div className="badge" style={{ marginTop: 12 }}>
            MVP: {report.mvpResult.name} ({report.mvpResult.percent}% van{" "}
            {report.mvpResult.totalVotes} stemmen)
          </div>
        ) : null}
        <div className="muted" style={{ marginTop: 12 }}>
          Gepubliceerd {new Date(report.createdAt).toLocaleString("nl-NL")}
        </div>
        <div className="mt-3">
          <MatchReportShareLink eventId={eventId} />
        </div>
        <MvpVotingPanel eventId={eventId} />
      </div>
    </main>
  );
}
