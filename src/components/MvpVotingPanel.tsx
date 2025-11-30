"use client";

import { useEffect, useMemo, useState } from "react";

type RosterEntry = { id: string; name: string };
type VoteBreakdown = { candidateId: string; name: string; votes: number; percent: number };
type ApiPayload = {
  eventId: string;
  status: "open" | "closed";
  roster: RosterEntry[];
  totalVotes: number;
  breakdown: VoteBreakdown[];
  hasVoted: boolean;
  votedFor: { id: string; name: string } | null;
  winner: VoteBreakdown | null;
  canClose: boolean;
  canReopen: boolean;
  closedAt: string | null;
};

type Props = { eventId: string; variant?: "card" | "inline" };

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.clone().json();
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
  } catch {
    // ignore JSON parse errors
  }
  try {
    const text = await res.text();
    if (text) return text;
  } catch {
    // ignore
  }
  return res.statusText || "Onbekende fout";
}

export default function MvpVotingPanel({ eventId, variant = "card" }: Props) {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/report/mvp?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(await parseError(res));
        }
        const payload = (await res.json()) as ApiPayload;
        if (!isMounted) return;
        setData(payload);
        if (payload.hasVoted && payload.votedFor) {
          setSelected(payload.votedFor.id);
        } else if (payload.roster.length) {
          setSelected((current) => (current && payload.roster.some((r) => r.id === current) ? current : payload.roster[0].id));
        } else {
          setSelected("");
        }
      } catch (err: any) {
        if (!isMounted) return;
        setError(err?.message || "Onbekende fout");
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => { isMounted = false; };
  }, [eventId]);

  const statusText = useMemo(() => {
    if (!data) return "";
    if (data.status === "open") {
      return "MVP voting still open";
    }
    if (data.winner) {
      return `MVP: ${data.winner.name} (${data.winner.percent}% van ${data.totalVotes} stemmen)`;
    }
    return "MVP voting closed";
  }, [data]);

  async function submitVote() {
    if (!data || !selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/report/mvp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, candidateId: selected }),
      });
      if (!res.ok) {
        throw new Error(await parseError(res));
      }
      const payload = (await res.json()) as ApiPayload;
      setData(payload);
      if (payload.votedFor) {
        setSelected(payload.votedFor.id);
      }
    } catch (err: any) {
      setError(err?.message || "Stemmen mislukt");
    } finally {
      setSubmitting(false);
    }
  }

  async function closeVoting() {
    setClosing(true);
    setError(null);
    try {
      const res = await fetch("/api/report/mvp/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      if (!res.ok) {
        throw new Error(await parseError(res));
      }
      const payload = (await fetch(`/api/report/mvp?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" }).then((r) => r.json())) as ApiPayload;
      setData(payload);
      if (payload.votedFor) {
        setSelected(payload.votedFor.id);
      }
    } catch (err: any) {
      setError(err?.message || "Sluiten mislukt");
    } finally {
      setClosing(false);
    }
  }

  async function reopenVoting() {
    setReopening(true);
    setError(null);
    try {
      const res = await fetch("/api/report/mvp/reopen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      if (!res.ok) {
        throw new Error(await parseError(res));
      }
      const payload = (await fetch(`/api/report/mvp?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" }).then((r) => r.json())) as ApiPayload;
      setData(payload);
      if (payload.votedFor) {
        setSelected(payload.votedFor.id);
      }
    } catch (err: any) {
      setError(err?.message || "Heropenen mislukt");
    } finally {
      setReopening(false);
    }
  }

  const isInline = variant === "inline";
  const Container: keyof JSX.IntrinsicElements = isInline ? "div" : "section";
  const containerClassName = isInline ? undefined : "card";
  const containerStyle = isInline ? undefined : { marginTop: 24 };

  if (loading && !data) {
    return (
      <Container className={containerClassName} style={containerStyle}>
        <h2 style={{ marginTop: 0 }}>Man of the Match</h2>
        <div className="muted">Laden…</div>
      </Container>
    );
  }

  return (
    <Container className={containerClassName} style={containerStyle}>
      <h2 style={{ marginTop: 0 }}>Man of the Match</h2>
      <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>{statusText}</p>
      {error ? <div style={{ color: "#ff7b72", marginBottom: 12 }}>{error}</div> : null}
      {!data ? null : (
        <>
          {data.status === "open" ? (
            <>
              {data.hasVoted ? (
                <div className="badge" style={{ marginBottom: 12 }}>Je stemde op {data.votedFor?.name}</div>
              ) : data.roster.length ? (
                <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  <label htmlFor="mvp-select" className="muted">Kies je MVP</label>
                  <select id="mvp-select" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={submitting || data.hasVoted}>
                    {data.roster.map((player) => (
                      <option key={player.id} value={player.id}>{player.name}</option>
                    ))}
                  </select>
                  <button onClick={submitVote} disabled={!selected || submitting || data.hasVoted}>
                    {submitting ? "Stem versturen…" : "Stem op MVP"}
                  </button>
                </div>
              ) : (
                <div className="muted" style={{ marginBottom: 12 }}>Geen spelerslijst beschikbaar.</div>
              )}
              {!data.hasVoted ? <div className="muted" style={{ fontSize: 13 }}>Je kunt maar één keer stemmen.</div> : null}
            </>
          ) : (
            <div className="badge" style={{ marginBottom: 12 }}>
              {data.winner ? `Gewonnen door ${data.winner.name}` : "Stemming gesloten"}
            </div>
          )}
          {data.breakdown.length ? (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {data.breakdown.map((row) => (
                <div key={row.candidateId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <span>{row.name}</span>
                  <span className="muted">{row.votes} stemmen ({row.percent}%)</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 12 }}>Er zijn nog geen stemmen.</div>
          )}
          {data.canClose ? (
            <button onClick={closeVoting} disabled={closing} style={{ marginTop: 16 }}>
              {closing ? "Stemming sluiten…" : "Sluit MVP-stemming"}
            </button>
          ) : null}
          {data.canReopen ? (
            <button onClick={reopenVoting} disabled={reopening} style={{ marginTop: 12 }}>
              {reopening ? "Stemming heropenen…" : "Heropen MVP-stemming"}
            </button>
          ) : null}
        </>
      )}
    </Container>
  );
}

