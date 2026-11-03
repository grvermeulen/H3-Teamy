"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import type {
  DiagramFrame,
  DiagramTeam,
  DrillCategory,
  DrillInput,
  DrillLevel,
} from "../../lib/schemas/speelboek";
import { readResponseJson } from "../../lib/safeClientJson";
import {
  TOOL_LABELS,
  addPlayer,
  clearArrowsFor,
  defaultRosterEntry,
  linesToList,
  nextStepFrame,
  setRole,
  toggleAttackColor,
  toggleRoster,
  validateDrillInput,
  type EditorTool,
} from "../../lib/speelboek/editor";
import { CATEGORY_LABELS, LEVEL_LABELS } from "../../lib/speelboek/lineup";
import type { LibraryDrill } from "../../lib/speelboek/library";
import { AppBar, Button, Input, Textarea, showToast } from "../ui";
import PoolDiagram from "./PoolDiagram";
import PoolEditorCanvas from "./PoolEditorCanvas";

const TOOLS: EditorTool[] = [
  "SELECT",
  "MOVE",
  "PASS",
  "SHOT",
  "BALL",
  "DELETE",
];
const CATEGORIES: DrillCategory[] = [
  "AANVAL",
  "VERDEDIGING",
  "TECHNIEK",
  "KEEPER",
];
const LEVELS: DrillLevel[] = ["BASIS", "GEMIDDELD", "GEVORDERD"];
/** Milliseconds per step in the editor's preview. */
export const PREVIEW_INTERVAL_MS = 1800;

type Props = {
  /** Drill to start from (empty, copied, AI draft or the stored drill being edited). */
  initial: DrillInput;
  /** Set when editing an existing trainer drill. */
  drillId?: string;
  /** Hints from the AI draft, shown above the editor. */
  warnings?: string[];
  /** Candidate counterparts (every drill except the one being edited). */
  counterparts: Pick<LibraryDrill, "id" | "title">[];
};

/**
 * Trainer editor for a drill: build each step on the pool (drag caps, draw
 * swim/pass/shot arrows, add or remove players, hand out the ball), give every
 * roster position a role per step, add steps that start from the previous end
 * positions, preview the animation and save (as draft or published).
 */
export default function DrillEditor({
  initial,
  drillId,
  warnings = [],
  counterparts,
}: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<DrillInput>(initial);
  const [stepIndex, setStepIndex] = useState(0);
  const [tool, setTool] = useState<EditorTool>("SELECT");
  const [selected, setSelected] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [keyPointsText, setKeyPointsText] = useState(
    initial.keyPoints.join("\n"),
  );
  const [mistakesText, setMistakesText] = useState(
    initial.commonMistakes.join("\n"),
  );

  const step = draft.steps[stepIndex];
  const labels = useMemo(
    () => Object.fromEntries(draft.roster.map((r) => [r.playerId, r.label])),
    [draft.roster],
  );
  const selectedPlayer = selected
    ? step.frame.players.find((p) => p.id === selected)
    : undefined;
  const selectedRoster = selected
    ? draft.roster.find((r) => r.playerId === selected)
    : undefined;
  const selectedRole = selected
    ? (step.roles.find((r) => r.playerId === selected)?.text ?? "")
    : "";

  useEffect(() => {
    if (previewIndex === null) return;
    if (previewIndex >= draft.steps.length - 1) {
      const t = window.setTimeout(
        () => setPreviewIndex(null),
        PREVIEW_INTERVAL_MS,
      );
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(
      () => setPreviewIndex(previewIndex + 1),
      PREVIEW_INTERVAL_MS,
    );
    return () => window.clearTimeout(t);
  }, [previewIndex, draft.steps.length]);

  function updateFrame(frame: DiagramFrame): void {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => (i === stepIndex ? { ...s, frame } : s)),
    }));
  }

  function updateStep(
    patch: Partial<Pick<DrillInput["steps"][number], "title" | "text">>,
  ): void {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => (i === stepIndex ? { ...s, ...patch } : s)),
    }));
  }

  function onRoleChange(text: string): void {
    if (!selected) return;
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) =>
        i === stepIndex ? setRole(s, selected, text) : s,
      ),
    }));
  }

  function onRosterField(field: "label" | "name", value: string): void {
    if (!selected) return;
    setDraft((d) => ({
      ...d,
      roster: d.roster.map((r) =>
        r.playerId === selected ? { ...r, [field]: value } : r,
      ),
    }));
  }

  function onAddPlayer(team: DiagramTeam): void {
    const result = addPlayer(step.frame, team);
    updateFrame(result.frame);
    setSelected(result.playerId);
    setTool("SELECT");
  }

  function onAddStep(): void {
    const frame = nextStepFrame(step.frame);
    const next = {
      title: `Stap ${draft.steps.length + 1}`,
      text: "",
      frame,
      roles: [],
    };
    setDraft((d) => ({
      ...d,
      steps: [
        ...d.steps.slice(0, stepIndex + 1),
        next,
        ...d.steps.slice(stepIndex + 1),
      ],
    }));
    setStepIndex(stepIndex + 1);
  }

  function onRemoveStep(): void {
    if (draft.steps.length <= 1) return;
    setDraft((d) => ({
      ...d,
      steps: d.steps.filter((_, i) => i !== stepIndex),
    }));
    setStepIndex(Math.max(0, stepIndex - 1));
  }

  async function onSave(): Promise<void> {
    const body: DrillInput = {
      ...draft,
      keyPoints: linesToList(keyPointsText),
      commonMistakes: linesToList(mistakesText),
    };
    const found = validateDrillInput(body);
    setProblems(found);
    if (found.length > 0) return;
    setSaving(true);
    try {
      const res = await fetch(
        drillId ? `/api/speelboek/drills/${drillId}` : "/api/speelboek/drills",
        {
          method: drillId ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = (await readResponseJson(res)) as {
        drill?: { id: string };
        error?: string;
      } | null;
      if (!res.ok || !json?.drill) {
        setProblems([
          json?.error ?? "Opslaan is niet gelukt. Probeer het opnieuw.",
        ]);
        return;
      }
      showToast(
        body.published ? "Oefening gepubliceerd" : "Concept opgeslagen",
        "success",
      );
      router.push(`/speelboek/${json.drill.id}` as Route);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(): Promise<void> {
    if (!drillId) return;
    if (
      !window.confirm(
        "Deze oefening verwijderen? Dit kan niet ongedaan worden gemaakt.",
      )
    ) {
      return;
    }
    const res = await fetch(`/api/speelboek/drills/${drillId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      showToast("Oefening verwijderd", "success");
      router.push("/speelboek");
      router.refresh();
    } else {
      setProblems(["Verwijderen is niet gelukt."]);
    }
  }

  const previewFrame =
    previewIndex !== null ? draft.steps[previewIndex].frame : null;

  return (
    <main>
      <div className="container">
        <AppBar
          title={drillId ? "Oefening bewerken" : "Nieuwe oefening"}
          fallbackHref={
            (drillId ? `/speelboek/${drillId}` : "/speelboek") as Route
          }
        />

        {warnings.length > 0 ? (
          <div className="card speelboek-warnings" role="status">
            <strong className="block mb-1">
              De AI heeft een opzet gemaakt – kijk dit even na:
            </strong>
            <ul className="m-0 pl-[18px] text-[13px]">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="speelboek-pool">
          {previewFrame ? (
            <PoolDiagram
              frame={previewFrame}
              labels={labels}
              title={`Voorbeeld stap ${(previewIndex ?? 0) + 1}`}
            />
          ) : (
            <PoolEditorCanvas
              frame={step.frame}
              labels={labels}
              tool={tool}
              selectedPlayerId={selected}
              onFrameChange={updateFrame}
              onSelect={setSelected}
            />
          )}
        </div>

        <div
          className="speelboek-chips"
          role="toolbar"
          aria-label="Gereedschap"
        >
          {TOOLS.map((t) => (
            <button
              key={t}
              type="button"
              className="speelboek-chip"
              aria-pressed={tool === t}
              onClick={() => setTool(t)}
            >
              {TOOL_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Button size="sm" onClick={() => onAddPlayer("OFF")}>
            + Aanvaller
          </Button>
          <Button size="sm" onClick={() => onAddPlayer("DEF")}>
            + Verdediger
          </Button>
          {step.frame.players.some((p) => p.team === "GK") ? null : (
            <Button size="sm" onClick={() => onAddPlayer("GK")}>
              + Keeper
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => updateFrame(toggleAttackColor(step.frame))}
          >
            Aanval in {step.frame.attackColor === "WHITE" ? "blauw" : "wit"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={step.frame.arrows.length === 0}
            onClick={() => updateFrame({ ...step.frame, arrows: [] })}
          >
            Pijlen wissen
          </Button>
        </div>

        {selectedPlayer ? (
          <div className="card" data-testid="player-panel">
            <div className="flex items-center justify-between gap-2 mb-2">
              <strong>
                {selectedRoster
                  ? `${selectedRoster.label} · ${selectedRoster.name}`
                  : `${defaultRosterEntry(selectedPlayer.id).name} (geen rol)`}
              </strong>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    !step.frame.arrows.some(
                      (a) => a.playerId === selectedPlayer.id,
                    )
                  }
                  onClick={() =>
                    updateFrame(clearArrowsFor(step.frame, selectedPlayer.id))
                  }
                >
                  Pijlen weg
                </Button>
                <Button
                  size="sm"
                  variant={selectedRoster ? "ghost" : "secondary"}
                  onClick={() =>
                    setDraft((d) => toggleRoster(d, selectedPlayer.id))
                  }
                >
                  {selectedRoster ? "Geen rol" : "Geef een rol"}
                </Button>
              </div>
            </div>
            {selectedRoster ? (
              <>
                <div className="grid grid-cols-[72px_1fr] gap-2">
                  <Input
                    label="Cap"
                    maxLength={2}
                    value={selectedRoster.label}
                    onChange={(e) => onRosterField("label", e.target.value)}
                  />
                  <Input
                    label="Positie"
                    maxLength={40}
                    value={selectedRoster.name}
                    onChange={(e) => onRosterField("name", e.target.value)}
                  />
                </div>
                <Textarea
                  label="Rol in deze stap"
                  rows={2}
                  maxLength={200}
                  placeholder="Bijv. Drijf naar de paal en vraag de bal."
                  value={selectedRole}
                  onChange={(e) => onRoleChange(e.target.value)}
                />
              </>
            ) : (
              <p className="muted text-[13px] m-0">
                Deze speler staat wel in het diagram, maar krijgt geen regel
                onder “Rol per positie”.
              </p>
            )}
          </div>
        ) : (
          <p className="muted text-[13px]">
            Tik op een speler om te verplaatsen of een rol te geven. Kies een
            pijl-gereedschap en sleep vanaf een speler om een actie te tekenen.
          </p>
        )}

        <h2 className="speelboek-section">
          Stap {stepIndex + 1} van {draft.steps.length}
        </h2>
        <div className="speelboek-stepper" aria-live="polite">
          <button
            type="button"
            className="speelboek-stepper-nav"
            aria-label="Vorige stap"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((i) => i - 1)}
          >
            ‹
          </button>
          <div className="speelboek-dots" aria-hidden="true">
            {draft.steps.map((_, i) => (
              <i key={i} data-on={i === stepIndex ? "true" : undefined} />
            ))}
          </div>
          <button
            type="button"
            className="speelboek-stepper-nav"
            aria-label="Volgende stap"
            disabled={stepIndex === draft.steps.length - 1}
            onClick={() => setStepIndex((i) => i + 1)}
          >
            ›
          </button>
        </div>
        <div className="card">
          <Input
            label="Titel van de stap"
            maxLength={60}
            value={step.title}
            onChange={(e) => updateStep({ title: e.target.value })}
          />
          <Textarea
            label="Wat gebeurt er in deze stap?"
            rows={3}
            maxLength={400}
            value={step.text}
            onChange={(e) => updateStep({ text: e.target.value })}
          />
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" onClick={onAddStep}>
              + Stap (vanaf eindposities)
            </Button>
            <Button
              size="sm"
              onClick={() => setPreviewIndex(previewIndex === null ? 0 : null)}
              disabled={draft.steps.length < 2}
            >
              {previewIndex === null ? "▶ Afspelen" : "Stop"}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={draft.steps.length <= 1}
              onClick={onRemoveStep}
            >
              Stap verwijderen
            </Button>
          </div>
        </div>

        <h2 className="speelboek-section">Over de oefening</h2>
        <div className="card">
          <Input
            label="Titel"
            maxLength={60}
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <Input
            label="Samenvatting (één regel)"
            maxLength={120}
            value={draft.summary}
            onChange={(e) =>
              setDraft((d) => ({ ...d, summary: e.target.value }))
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="ui-field">
              <label htmlFor="drill-category">Categorie</label>
              <select
                id="drill-category"
                className="ui-input"
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    category: e.target.value as DrillCategory,
                  }))
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="ui-field">
              <label htmlFor="drill-level">Niveau</label>
              <select
                id="drill-level"
                className="ui-input"
                value={draft.level}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    level: e.target.value as DrillLevel,
                  }))
                }
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABELS[l]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Textarea
            label="Let op (één punt per regel)"
            rows={3}
            value={keyPointsText}
            onChange={(e) => setKeyPointsText(e.target.value)}
          />
          <Textarea
            label="Veelgemaakte fouten (één per regel)"
            rows={3}
            value={mistakesText}
            onChange={(e) => setMistakesText(e.target.value)}
          />
          <div className="ui-field">
            <label htmlFor="drill-counterpart">
              Tegenhanger (aanval ↔ verdediging)
            </label>
            <select
              id="drill-counterpart"
              className="ui-input"
              value={draft.counterpartId ?? ""}
              onChange={(e) =>
                setDraft((d) => {
                  const { counterpartId: _old, ...rest } = d;
                  return e.target.value
                    ? { ...rest, counterpartId: e.target.value }
                    : rest;
                })
              }
            >
              <option value="">Geen</option>
              {counterparts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(e) =>
                setDraft((d) => ({ ...d, published: e.target.checked }))
              }
            />
            Zichtbaar voor spelers in het speelboek
          </label>
        </div>

        {problems.length > 0 ? (
          <div
            className="card"
            role="alert"
            style={{ borderColor: "var(--negative)" }}
          >
            <ul className="m-0 pl-[18px] text-[13px]">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex gap-2 mb-6">
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => void onSave()}
            loading={saving}
            loadingLabel="Opslaan…"
          >
            {draft.published ? "Opslaan en publiceren" : "Opslaan als concept"}
          </Button>
          {drillId ? (
            <Button variant="danger" onClick={() => void onDelete()}>
              Oefening verwijderen
            </Button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
