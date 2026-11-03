"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Route } from "next";
import type { ProgramItemInput } from "../../lib/schemas/speelboek";
import { fetchJsonIfOkOr, readResponseJson } from "../../lib/safeClientJson";
import { CATEGORY_LABELS } from "../../lib/speelboek/lineup";
import type { LibraryDrill } from "../../lib/speelboek/library";
import type { ProgramItem } from "../../lib/services/trainingProgramService";
import { Button, showToast } from "../ui";

type Props = {
  /** Training date, `YYYY-MM-DD`. */
  date: string;
};

type Row = ProgramItemInput & {
  title: string;
  category: string;
  ackCount: number;
};

type ProgramResponse = {
  items: ProgramItem[];
  ackCounts?: Record<string, number>;
};

/**
 * Trainer block on the training page: pick drills from the speelboek for this
 * training, order them, give each a duration, save, and send the list to the
 * team WhatsApp group. Shows how many players ticked each drill off.
 */
export default function TrainingProgramEditor({ date }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [drills, setDrills] = useState<LibraryDrill[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [program, list] = await Promise.all([
        fetchJsonIfOkOr<ProgramResponse>(
          `/api/speelboek/program/${date}`,
          undefined,
          "training-program-get",
        ),
        fetchJsonIfOkOr<{ drills: LibraryDrill[] }>(
          "/api/speelboek/drills",
          undefined,
          "training-program-drills",
        ),
      ]);
      if (cancelled) return;
      setDrills(list?.drills ?? []);
      setRows(
        (program?.items ?? [])
          .filter((i) => i.drill)
          .map((i) => ({
            drillId: i.drillId,
            minutes: i.minutes ?? undefined,
            note: i.note ?? undefined,
            title: i.drill!.title,
            category: CATEGORY_LABELS[i.drill!.category],
            ackCount: program?.ackCounts?.[i.drillId] ?? 0,
          })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  function update(mutate: (rows: Row[]) => Row[]): void {
    setRows((r) => (r ? mutate(r) : r));
    setDirty(true);
  }

  function add(drillId: string): void {
    const drill = drills.find((d) => d.id === drillId);
    if (!drill) return;
    update((r) =>
      r.some((x) => x.drillId === drillId)
        ? r
        : [
            ...r,
            {
              drillId,
              minutes: 10,
              title: drill.title,
              category: CATEGORY_LABELS[drill.category],
              ackCount: 0,
            },
          ],
    );
  }

  function move(index: number, delta: -1 | 1): void {
    update((r) => {
      const next = [...r];
      const target = index + delta;
      if (target < 0 || target >= next.length) return r;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save(): Promise<void> {
    if (!rows) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/speelboek/program/${date}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: rows.map(({ drillId, minutes, note }) => ({
            drillId,
            ...(minutes ? { minutes } : {}),
            ...(note ? { note } : {}),
          })),
        }),
      });
      if (!res.ok) {
        setError("Programma opslaan is niet gelukt.");
        return;
      }
      setDirty(false);
      showToast("Programma opgeslagen", "success");
    } finally {
      setSaving(false);
    }
  }

  async function share(): Promise<void> {
    setSharing(true);
    setError(null);
    try {
      const res = await fetch(`/api/speelboek/program/${date}/share`, {
        method: "POST",
      });
      const json = (await readResponseJson(res)) as {
        sent: boolean;
        reason?: string;
      } | null;
      if (json?.sent) {
        showToast("Programma naar de WhatsApp-groep gestuurd", "success");
      } else {
        setError(
          json?.reason === "disabled" || json?.reason === "missing_config"
            ? "WhatsApp-berichten staan uit voor deze omgeving."
            : "Versturen naar WhatsApp is niet gelukt.",
        );
      }
    } finally {
      setSharing(false);
    }
  }

  const available = drills.filter(
    (d) => !rows?.some((r) => r.drillId === d.id),
  );
  const totalMinutes = rows?.reduce((sum, r) => sum + (r.minutes ?? 0), 0) ?? 0;

  return (
    <section aria-label="Programma" className="mt-4">
      <h2 className="speelboek-section">
        Programma
        {totalMinutes > 0 ? (
          <span className="speelboek-section-note">· {totalMinutes} min</span>
        ) : null}
      </h2>
      {rows === null ? (
        <p className="muted text-[13px]">Laden…</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="muted text-[13px]">
              Nog geen oefeningen gekoppeld. Kies er hieronder een uit het
              speelboek.
            </p>
          ) : (
            <ol className="speelboek-program-list">
              {rows.map((row, i) => (
                <li key={row.drillId} className="card">
                  <div className="flex items-center gap-2">
                    <span className="speelboek-cap" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/speelboek/${row.drillId}` as Route}
                        className="font-semibold block truncate"
                      >
                        {row.title}
                      </Link>
                      <span className="muted text-xs">
                        {row.category}
                        {row.ackCount > 0
                          ? ` · ${row.ackCount}× afgevinkt`
                          : ""}
                      </span>
                    </span>
                    <label className="speelboek-minutes">
                      <input
                        type="number"
                        min={1}
                        max={120}
                        inputMode="numeric"
                        aria-label={`Minuten voor ${row.title}`}
                        value={row.minutes ?? ""}
                        onChange={(e) =>
                          update((r) =>
                            r.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    minutes: e.target.value
                                      ? Number(e.target.value)
                                      : undefined,
                                  }
                                : x,
                            ),
                          )
                        }
                      />
                      <span className="muted text-xs">min</span>
                    </label>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Omhoog"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Omlaag"
                      disabled={i === rows.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => update((r) => r.filter((_, j) => j !== i))}
                    >
                      Weghalen
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {available.length > 0 ? (
            <div className="ui-field">
              <label htmlFor="program-add">Oefening toevoegen</label>
              <select
                id="program-add"
                className="ui-input"
                value=""
                onChange={(e) => add(e.target.value)}
              >
                <option value="">Kies uit het speelboek…</option>
                {available.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                    {d.published ? "" : " (concept)"}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="muted"
              style={{ color: "var(--negative)" }}
            >
              {error}
            </div>
          ) : null}

          <div className="flex gap-2 mt-2">
            <Button
              variant="primary"
              disabled={!dirty}
              loading={saving}
              loadingLabel="Opslaan…"
              onClick={() => void save()}
            >
              Programma opslaan
            </Button>
            <Button
              disabled={dirty || rows.length === 0}
              loading={sharing}
              loadingLabel="Versturen…"
              onClick={() => void share()}
            >
              Stuur naar WhatsApp-groep
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
