"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Route } from "next";
import type { DrillInput } from "../../lib/schemas/speelboek";
import { fetchJsonIfOkOr } from "../../lib/safeClientJson";
import type { LibraryDrill } from "../../lib/speelboek/library";
import { AppBar, EmptyState } from "../ui";
import DrillEditor from "./DrillEditor";

type Props = {
  drillId: string;
  initial: DrillInput;
  counterparts: Pick<LibraryDrill, "id" | "title">[];
};

/**
 * Shows {@link DrillEditor} to trainers only. The API enforces the same rule;
 * this just keeps players from seeing a form they cannot submit.
 */
export default function EditDrillGate({
  drillId,
  initial,
  counterparts,
}: Props) {
  const [isTrainer, setIsTrainer] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJsonIfOkOr<{ isTrainer: boolean }>(
      "/api/trainer/status",
      undefined,
      "speelboek-edit-status",
    ).then((status) => {
      if (!cancelled) setIsTrainer(Boolean(status?.isTrainer));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isTrainer === null) {
    return (
      <main>
        <div className="container">
          <AppBar
            title="Oefening bewerken"
            fallbackHref={`/speelboek/${drillId}` as Route}
          />
          <p className="muted">Laden…</p>
        </div>
      </main>
    );
  }
  if (!isTrainer) {
    return (
      <main>
        <div className="container">
          <AppBar
            title="Oefening bewerken"
            fallbackHref={`/speelboek/${drillId}` as Route}
          />
          <EmptyState
            title="Alleen voor trainers"
            body="Oefeningen bewerken kan alleen als trainer."
            action={
              <Link
                href={`/speelboek/${drillId}` as Route}
                className="ui-btn"
                data-variant="secondary"
              >
                Terug naar de oefening
              </Link>
            }
          />
        </div>
      </main>
    );
  }
  return (
    <DrillEditor
      drillId={drillId}
      initial={initial}
      counterparts={counterparts}
    />
  );
}
