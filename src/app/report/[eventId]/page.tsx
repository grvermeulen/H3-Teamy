import { notFound } from "next/navigation";
import { getReport } from "../../../lib/kv";
import MvpVotingPanel from "../../../components/MvpVotingPanel";
import { AppBar } from "../../../components/ui";

type Params = {
  params: Promise<{ eventId: string }> | { eventId: string };
};

export const revalidate = 0;

export default async function ReportPage({ params }: Params) {
  const { eventId } = await Promise.resolve(params);
  const report = await getReport(eventId);
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
        <MvpVotingPanel eventId={eventId} />
      </div>
    </main>
  );
}
