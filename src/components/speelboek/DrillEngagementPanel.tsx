"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Route } from "next";
import { fetchJsonIfOkOr, readResponseJson } from "../../lib/safeClientJson";
import type {
  DrillEngagement,
  DrillQuestionView,
} from "../../lib/services/drillEngagementService";
import type { LibraryDrill } from "../../lib/speelboek/library";
import { Button, Textarea, showToast } from "../ui";

type Props = {
  drillId: string;
  source: LibraryDrill["source"];
};

type EngagementResponse = DrillEngagement & { isTrainer: boolean };

/**
 * Player actions under a drill — "Ik snap 'm" with the team count and "Vraag aan
 * trainer" — plus, for trainers, the open questions with a "Afgehandeld" button
 * and links to edit (trainer drills) or copy (library drills) the drill.
 */
export default function DrillEngagementPanel({ drillId, source }: Props) {
  const [data, setData] = useState<EngagementResponse | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [showAsk, setShowAsk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchJsonIfOkOr<EngagementResponse>(
      `/api/speelboek/drills/${drillId}/engagement`,
      undefined,
      "speelboek-engagement",
    ).then((res) => {
      if (!cancelled && res) setData(res);
    });
    return () => {
      cancelled = true;
    };
  }, [drillId]);

  async function toggleAck(): Promise<void> {
    if (!data) return;
    const next = !data.acked;
    const res = await fetch(`/api/speelboek/drills/${drillId}/ack`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acked: next }),
    });
    const json = (await readResponseJson(res)) as {
      acked: boolean;
      ackCount: number;
      error?: string;
    } | null;
    if (!res.ok || !json) {
      showToast(json?.error ?? "Afvinken is niet gelukt", "error");
      return;
    }
    setData({ ...data, acked: json.acked, ackCount: json.ackCount });
  }

  async function ask(): Promise<void> {
    if (!data || question.trim().length < 3) return;
    setAsking(true);
    try {
      const res = await fetch(`/api/speelboek/drills/${drillId}/questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: question.trim() }),
      });
      const json = (await readResponseJson(res)) as {
        question?: DrillQuestionView;
        error?: string;
      } | null;
      if (!res.ok || !json?.question) {
        showToast(json?.error ?? "Vraag versturen is niet gelukt", "error");
        return;
      }
      setData({ ...data, questions: [json.question, ...data.questions] });
      setQuestion("");
      setShowAsk(false);
      showToast("Je vraag staat bij de trainer", "success");
    } finally {
      setAsking(false);
    }
  }

  async function resolve(questionId: string): Promise<void> {
    if (!data) return;
    const res = await fetch(
      `/api/speelboek/drills/${drillId}/questions/${questionId}`,
      { method: "PATCH" },
    );
    if (!res.ok) {
      showToast("Afhandelen is niet gelukt", "error");
      return;
    }
    setData({
      ...data,
      questions: data.questions.map((q) =>
        q.id === questionId
          ? { ...q, resolvedAt: new Date().toISOString() }
          : q,
      ),
    });
  }

  if (!data) return null;

  const openQuestions = data.questions.filter((q) => !q.resolvedAt);

  return (
    <section aria-label="Jouw reactie" className="mt-3">
      <div className="flex gap-2">
        <Button
          variant={data.acked ? "secondary" : "primary"}
          className="flex-1"
          aria-pressed={data.acked}
          onClick={() => void toggleAck()}
        >
          {data.acked ? "✓ Gesnapt" : "Ik snap 'm"}
        </Button>
        <Button
          className="flex-1"
          onClick={() => setShowAsk((v) => !v)}
          aria-expanded={showAsk}
        >
          Vraag aan trainer
        </Button>
      </div>
      <p className="muted text-xs mt-1.5">
        {data.ackCount === 0
          ? "Nog niemand heeft deze afgevinkt."
          : data.ackCount === 1
            ? "1 speler heeft deze afgevinkt."
            : `${data.ackCount} spelers hebben deze afgevinkt.`}
      </p>

      {showAsk ? (
        <div className="card">
          <Textarea
            label="Wat wil je weten?"
            rows={3}
            maxLength={500}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Bijv. Wat doe ik als 2 niet vrij is?"
          />
          <Button
            variant="primary"
            size="sm"
            disabled={question.trim().length < 3}
            loading={asking}
            loadingLabel="Versturen…"
            onClick={() => void ask()}
          >
            Verstuur
          </Button>
        </div>
      ) : null}

      {data.questions.length > 0 ? (
        <>
          <h2 className="speelboek-section">
            {data.isTrainer ? "Vragen van spelers" : "Jouw vragen"}
            {data.isTrainer && openQuestions.length > 0 ? (
              <span className="speelboek-section-note">
                · {openQuestions.length} open
              </span>
            ) : null}
          </h2>
          <ul className="speelboek-questions">
            {data.questions.map((q) => (
              <li
                key={q.id}
                className="card"
                data-resolved={q.resolvedAt ? "true" : undefined}
              >
                <p className="m-0 text-[14px]">{q.text}</p>
                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <span className="muted text-xs">
                    {q.askedBy ? `${q.askedBy} · ` : ""}
                    {new Date(q.createdAt).toLocaleDateString("nl-NL", {
                      day: "numeric",
                      month: "short",
                    })}
                    {q.resolvedAt ? " · afgehandeld" : ""}
                  </span>
                  {data.isTrainer && !q.resolvedAt ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void resolve(q.id)}
                    >
                      Afgehandeld
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {data.isTrainer ? (
        <div className="flex gap-2 mt-3">
          {source === "trainer" ? (
            <Link
              href={`/speelboek/${drillId}/bewerken` as Route}
              className="ui-btn flex-1"
              data-variant="secondary"
            >
              Bewerken
            </Link>
          ) : null}
          <Link
            href={`/speelboek/nieuw?van=${drillId}` as Route}
            className="ui-btn flex-1"
            data-variant="ghost"
          >
            Kopiëren als nieuwe oefening
          </Link>
        </div>
      ) : null}
    </section>
  );
}
