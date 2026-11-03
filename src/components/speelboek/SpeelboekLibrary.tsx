"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Route } from "next";
import type { Drill, DrillCategory } from "../../lib/schemas/speelboek";
import { CATEGORY_LABELS } from "../../lib/speelboek/lineup";
import {
  groupByCategory,
  isRecentlyAdded,
  listDrills,
  rosterLabels,
} from "../../lib/services/speelboekService";
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
};

/**
 * Speelboek library: search box, category chips and drills grouped by category,
 * each with a thumbnail of its first step. Filtering happens client-side on the
 * static drill content via {@link listDrills}.
 *
 * @param nowIso - Reference time for the "Nieuw" badge.
 */
export default function SpeelboekLibrary({ nowIso }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DrillCategory | "ALL">("ALL");
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  const drills = useMemo(
    () =>
      listDrills({
        query,
        category: category === "ALL" ? undefined : category,
      }),
    [query, category],
  );
  const groups = useMemo(() => groupByCategory(drills), [drills]);
  const recent = drills.filter((d) => isRecentlyAdded(d, now));

  return (
    <main>
      <div className="container">
        <h1 className="text-[22px] font-bold mt-1 mb-0.5">Speelboek</h1>
        <p className="muted text-[13px] mt-0 mb-3.5">
          Tactiek en techniek van H3 – voor in en naast het water
        </p>

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
            {recent.length > 0 && category === "ALL" && !query ? (
              <DrillGroup title="Nieuw" drills={recent} now={now} />
            ) : null}
            {groups.map((g) => (
              <DrillGroup
                key={g.category}
                title={CATEGORY_LABELS[g.category]}
                drills={g.drills}
                now={now}
              />
            ))}
          </>
        )}
      </div>
    </main>
  );
}

function DrillGroup({
  title,
  drills,
  now,
}: {
  title: string;
  drills: Drill[];
  now: Date;
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
                  {isRecentlyAdded(drill, now) ? (
                    <span className="badge speelboek-badge-new">Nieuw</span>
                  ) : null}
                </span>
                <span className="block muted text-[13px]">
                  {CATEGORY_LABELS[drill.category]} · {drill.steps.length}{" "}
                  {drill.steps.length === 1 ? "stap" : "stappen"}
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
