"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import type { DrillCategory } from "../../lib/schemas/speelboek";
import { fetchJsonIfOkOr } from "../../lib/safeClientJson";
import { CATEGORY_LABELS } from "../../lib/speelboek/lineup";
import {
  filterDrills,
  groupByCategory,
  isRecentlyAdded,
  rosterLabels,
  type LibraryDrill,
} from "../../lib/speelboek/library";
import type { TrainingProgram } from "../../lib/services/trainingProgramService";
import { describeRelativeDay } from "../../lib/training";
import { EmptyState, Input } from "../ui";
import PoolDiagram from "./PoolDiagram";

const CATEGORY_ORDER: DrillCategory[] = [
  "AANVAL",
  "VERDEDIGING",
  "TECHNIEK",
  "KEEPER",
];

type Props = {
  /** ISO timestamp of "now", passed from the server so the "Nieuw" badge is deterministic. */
  nowIso: string;
  /** Drills rendered on first paint (static + published); trainers get drafts after hydration. */
  initialDrills: LibraryDrill[];
  /** Programme of the next training with one, or `null`. */
  program: TrainingProgram | null;
};

/**
 * Speelboek library: "Vanavond oefenen we" for the next training, search box,
 * category chips and drills grouped by category with a thumbnail of their first
 * step. Trainers additionally see their drafts and a button to create a drill.
 */
export default function SpeelboekLibrary({
  nowIso,
  initialDrills,
  program,
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DrillCategory | "ALL">("ALL");
  const [allDrills, setAllDrills] = useState(initialDrills);
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [isTrainer, setIsTrainer] = useState(false);
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [status, acks, drills] = await Promise.all([
        fetchJsonIfOkOr<{ isTrainer: boolean }>(
          "/api/trainer/status",
          undefined,
          "speelboek-trainer-status",
        ),
        fetchJsonIfOkOr<{ drillIds: string[] }>(
          "/api/speelboek/acks",
          undefined,
          "speelboek-acks",
        ),
        fetchJsonIfOkOr<{ drills: LibraryDrill[] }>(
          "/api/speelboek/drills",
          undefined,
          "speelboek-drills",
        ),
      ]);
      if (cancelled) return;
      if (status) setIsTrainer(Boolean(status.isTrainer));
      if (acks) setAcked(new Set(acks.drillIds));
      if (drills && drills.drills.length > 0) setAllDrills(drills.drills);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const drills = useMemo(
    () =>
      filterDrills(allDrills, {
        query,
        category: category === "ALL" ? undefined : category,
      }),
    [allDrills, query, category],
  );
  const groups = useMemo(() => groupByCategory(drills), [drills]);
  const recent = drills.filter((d) => isRecentlyAdded(d, now));
  const unfiltered = category === "ALL" && !query;

  return (
    <main>
      <div className="container">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[22px] font-bold mt-1 mb-0.5">Speelboek</h1>
            <p className="muted text-[13px] mt-0 mb-3.5">
              Tactiek en techniek van H3 – voor in en naast het water
            </p>
          </div>
          {isTrainer ? (
            <Link
              href={"/speelboek/nieuw" as Route}
              className="ui-btn mt-1"
              data-variant="primary"
              data-size="sm"
            >
              + Nieuwe oefening
            </Link>
          ) : null}
        </div>

        {program && unfiltered ? (
          <ProgramSection program={program} now={now} acked={acked} />
        ) : null}

        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Zoek oefening, positie of situatie…"
          aria-label="Zoek in het speelboek"
        />

        <div
          className="speelboek-chips"
          role="group"
          aria-label="Filter op categorie"
        >
          <button
            type="button"
            className="speelboek-chip"
            aria-pressed={category === "ALL"}
            onClick={() => setCategory("ALL")}
          >
            Alles
          </button>
          {CATEGORY_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              className="speelboek-chip"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        {drills.length === 0 ? (
          <EmptyState
            title="Geen oefeningen gevonden"
            body="Probeer een andere zoekterm of categorie."
          />
        ) : (
          <>
            {recent.length > 0 && unfiltered ? (
              <DrillGroup
                title="Nieuw"
                drills={recent}
                now={now}
                acked={acked}
              />
            ) : null}
            {groups.map((g) => (
              <DrillGroup
                key={g.category}
                title={CATEGORY_LABELS[g.category]}
                drills={g.drills}
                now={now}
                acked={acked}
              />
            ))}
          </>
        )}
      </div>
    </main>
  );
}

function ProgramSection({
  program,
  now,
  acked,
}: {
  program: TrainingProgram;
  now: Date;
  acked: Set<string>;
}) {
  const day = describeRelativeDay(new Date(`${program.date}T12:00:00`), now);
  const heading =
    day === "vandaag" ? "Vanavond oefenen we" : `Training ${day}: we oefenen`;
  return (
    <section aria-label={heading} className="mb-3">
      <h2 className="speelboek-section">{heading}</h2>
      <ul className="list-none p-0 m-0 grid gap-2">
        {program.items.map((item) =>
          item.drill ? (
            <li key={item.id}>
              <Link
                href={`/speelboek/${item.drillId}` as Route}
                className="card speelboek-drill-card speelboek-program-card"
              >
                <span className="speelboek-thumb" aria-hidden="true">
                  <PoolDiagram
                    frame={item.drill.steps[0].frame}
                    labels={rosterLabels(item.drill)}
                    mini
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold block">
                    {item.drill.title}
                  </span>
                  <span className="block muted text-[13px]">
                    {CATEGORY_LABELS[item.drill.category]}
                    {item.minutes ? ` · ${item.minutes} min` : ""}
                    {acked.has(item.drillId) ? " · ✓ gesnapt" : ""}
                  </span>
                  {item.note ? (
                    <span className="block text-[13px] mt-0.5">
                      {item.note}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ) : null,
        )}
      </ul>
    </section>
  );
}

function DrillGroup({
  title,
  drills,
  now,
  acked,
}: {
  title: string;
  drills: LibraryDrill[];
  now: Date;
  acked: Set<string>;
}) {
  return (
    <section aria-label={title}>
      <h2 className="speelboek-section">{title}</h2>
      <ul className="list-none p-0 m-0 grid gap-3">
        {drills.map((drill) => (
          <li key={drill.id}>
            <Link
              href={`/speelboek/${drill.id}` as Route}
              className="card speelboek-drill-card"
            >
              <span className="speelboek-thumb" aria-hidden="true">
                <PoolDiagram
                  frame={drill.steps[0].frame}
                  labels={rosterLabels(drill)}
                  mini
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-semibold flex-1 min-w-0">
                    {drill.title}
                  </span>
                  {!drill.published ? (
                    <span className="badge">Concept</span>
                  ) : isRecentlyAdded(drill, now) ? (
                    <span className="badge speelboek-badge-new">Nieuw</span>
                  ) : null}
                </span>
                <span className="block muted text-[13px]">
                  {CATEGORY_LABELS[drill.category]} · {drill.steps.length}{" "}
                  {drill.steps.length === 1 ? "stap" : "stappen"}
                  {acked.has(drill.id) ? " · ✓ gesnapt" : ""}
                </span>
                <span className="block text-[13px] mt-0.5">
                  {drill.summary}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
