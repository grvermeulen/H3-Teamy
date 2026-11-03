"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Route } from "next";
import type { DrillInput } from "../../lib/schemas/speelboek";
import { fetchJsonIfOkOr, readResponseJson } from "../../lib/safeClientJson";
import { drillToInput, newDrillInput } from "../../lib/speelboek/editor";
import type { LibraryDrill } from "../../lib/speelboek/library";
import { AppBar, Button, EmptyState, Textarea } from "../ui";
import DrillEditor from "./DrillEditor";
import { useDictation } from "./useDictation";

/** Longest side of a whiteboard photo sent to the AI, in pixels. */
export const PHOTO_MAX_SIDE = 1600;

type Props = {
  /** Slug of a drill to start from as a copy (`?van=`). */
  copyFromId?: string;
};

type Stage =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "choose" }
  | { kind: "editor"; initial: DrillInput; warnings: string[] };

/**
 * Entry point for a new trainer drill: describe or dictate it (AI makes a
 * draft), photograph the whiteboard (AI reads it), or build it from the
 * standard lineup. Every path ends in {@link DrillEditor}.
 */
export default function NewDrillFlow({ copyFromId }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [counterparts, setCounterparts] = useState<
    Pick<LibraryDrill, "id" | "title">[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [status, list] = await Promise.all([
        fetchJsonIfOkOr<{ isTrainer: boolean }>(
          "/api/trainer/status",
          undefined,
          "speelboek-new-status",
        ),
        fetchJsonIfOkOr<{ drills: LibraryDrill[] }>(
          "/api/speelboek/drills",
          undefined,
          "speelboek-new-drills",
        ),
      ]);
      if (cancelled) return;
      if (!status?.isTrainer) {
        setStage({ kind: "forbidden" });
        return;
      }
      const drills = list?.drills ?? [];
      setCounterparts(drills.map((d) => ({ id: d.id, title: d.title })));
      if (copyFromId) {
        const source = drills.find((d) => d.id === copyFromId);
        if (source) {
          const copy = drillToInput(source, false);
          setStage({
            kind: "editor",
            initial: { ...copy, title: `${copy.title} (kopie)`.slice(0, 60) },
            warnings: [],
          });
          return;
        }
      }
      setStage({ kind: "choose" });
    })();
    return () => {
      cancelled = true;
    };
  }, [copyFromId]);

  switch (stage.kind) {
    case "loading":
      return (
        <main>
          <div className="container">
            <AppBar title="Nieuwe oefening" fallbackHref="/speelboek" />
            <p className="muted">Laden…</p>
          </div>
        </main>
      );
    case "forbidden":
      return (
        <main>
          <div className="container">
            <AppBar title="Nieuwe oefening" fallbackHref="/speelboek" />
            <EmptyState
              title="Alleen voor trainers"
              body="Oefeningen toevoegen kan alleen als trainer."
              action={
                <Link
                  href={"/speelboek" as Route}
                  className="ui-btn"
                  data-variant="secondary"
                >
                  Terug naar het speelboek
                </Link>
              }
            />
          </div>
        </main>
      );
    case "choose":
      return (
        <Chooser
          onDraft={(initial, warnings) =>
            setStage({ kind: "editor", initial, warnings })
          }
        />
      );
    case "editor":
      return (
        <DrillEditor
          initial={stage.initial}
          warnings={stage.warnings}
          counterparts={counterparts}
        />
      );
    default: {
      const exhaustive: never = stage;
      return exhaustive;
    }
  }
}

async function downscalePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

function Chooser({
  onDraft,
}: {
  onDraft: (initial: DrillInput, warnings: string[]) => void;
}) {
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dictation = useDictation((text) =>
    setDescription((d) => (d ? `${d} ${text}` : text)),
  );

  async function onPhoto(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      setPhoto(await downscalePhoto(file));
      setError(null);
    } catch {
      setError("Deze foto kon niet worden gelezen. Probeer een jpg of png.");
    }
  }

  async function makeDraft(): Promise<void> {
    dictation.stop();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/speelboek/ai/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description,
          ...(photo ? { imageDataUrl: photo } : {}),
        }),
      });
      const json = (await readResponseJson(res)) as {
        draft?: DrillInput;
        warnings?: string[];
        error?: string;
      } | null;
      if (!res.ok || !json?.draft) {
        setError(
          json?.error ??
            "De AI kon hier geen oefening van maken. Probeer het met meer detail.",
        );
        return;
      }
      onDraft(json.draft, json.warnings ?? []);
    } finally {
      setBusy(false);
    }
  }

  const canDraft = description.trim().length > 0 || photo !== null;

  return (
    <main>
      <div className="container">
        <AppBar title="Nieuwe oefening" fallbackHref="/speelboek" />
        <p className="muted text-[13px] mt-0">
          Kies hoe je begint. Alles komt uit in dezelfde editor, dus je kunt het
          resultaat altijd nog aanpassen.
        </p>

        <h2 className="speelboek-section">Beschrijven of inspreken</h2>
        <div className="card">
          <Textarea
            label="Hoe gaat de oefening?"
            rows={5}
            maxLength={4000}
            placeholder="Bijv. 4-2 man-meer. Bal begint bij 3. 3 speelt naar 2, 2 speelt direct door naar 1 op de paal, 1 schiet. Verdediger van 6 is eruit."
            value={
              dictation.interim
                ? `${description} ${dictation.interim}`.trim()
                : description
            }
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5 items-center">
            {dictation.supported ? (
              <Button
                size="sm"
                variant={dictation.listening ? "danger" : "secondary"}
                onClick={dictation.listening ? dictation.stop : dictation.start}
                aria-pressed={dictation.listening}
              >
                {dictation.listening ? "■ Stop opnemen" : "🎤 Inspreken"}
              </Button>
            ) : (
              <span className="muted text-xs">
                Inspreken werkt in Chrome en Safari; hier kun je typen.
              </span>
            )}
            {dictation.listening ? (
              <span className="muted text-xs" aria-live="polite">
                Luistert… praat rustig, in stappen.
              </span>
            ) : null}
          </div>
          {dictation.error ? (
            <p className="text-[13px] m-0 mt-2" role="alert">
              {dictation.error}
            </p>
          ) : null}
        </div>

        <h2 className="speelboek-section">Foto van het whiteboard</h2>
        <div className="card">
          <label className="ui-btn" data-variant="secondary" data-size="sm">
            {photo ? "Andere foto kiezen" : "📷 Foto kiezen of maken"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => void onPhoto(e.target.files?.[0])}
            />
          </label>
          {photo ? (
            <div className="mt-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
              <img
                src={photo}
                alt="Gekozen whiteboardfoto"
                className="speelboek-photo"
              />
              <Button size="sm" variant="ghost" onClick={() => setPhoto(null)}>
                Foto weghalen
              </Button>
            </div>
          ) : (
            <p className="muted text-[13px] m-0 mt-2">
              Cirkels met nummers worden spelers, pijlen worden acties.
            </p>
          )}
        </div>

        {error ? (
          <div
            className="card"
            role="alert"
            style={{ borderColor: "var(--negative)" }}
          >
            {error}
          </div>
        ) : null}

        <Button
          variant="primary"
          isFullWidth
          disabled={!canDraft}
          loading={busy}
          loadingLabel="De AI bouwt de oefening…"
          onClick={() => void makeDraft()}
        >
          ✨ Maak een opzet
        </Button>

        <h2 className="speelboek-section">Zelf bouwen</h2>
        <div className="card">
          <p className="text-[13px] m-0 mb-2">
            Begin met de standaardopstelling (1 rechts → 5 links, 6 midvoor) en
            bouw de stappen zelf.
          </p>
          <Button isFullWidth onClick={() => onDraft(newDrillInput(), [])}>
            Open de editor
          </Button>
        </div>
      </div>
    </main>
  );
}
