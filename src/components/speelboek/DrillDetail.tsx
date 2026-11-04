"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Route } from "next";
import type { Drill } from "../../lib/schemas/speelboek";
import {
  CATEGORY_LABELS,
  LEVEL_LABELS,
  rosterCapTone,
} from "../../lib/speelboek/lineup";
import { rosterLabels, type LibraryDrill } from "../../lib/speelboek/library";
import { playbackFrame } from "../../lib/speelboek/playback";
import { useDialogFocusTrap } from "../cityArena/useDialogFocusTrap";
import { AppBar, Button } from "../ui";
import DrillEngagementPanel from "./DrillEngagementPanel";
import PoolDiagram from "./PoolDiagram";
import { usePlaybackClock } from "./usePlaybackClock";

/** Milliseconds per step while the animation plays. */
export const PLAY_INTERVAL_MS = 2500;

const STORAGE_PREFIX = "speelboek:position:";

type Props = {
  drill: LibraryDrill;
  counterpart: Drill | null;
};

/**
 * Drill detail: diagram with a step-by-step stepper, fullscreen playback
 * (portrait stacks the pool above the controls, landscape places them side by
 * side), the role of every roster position per step (with the reader's own
 * position highlighted and remembered per drill in `localStorage`), key points,
 * common mistakes and a link to the counterpart drill (attack <-> defence).
 *
 * @param drill - Drill to show.
 * @param counterpart - Drill showing the same situation from the other side, if any.
 */
export default function DrillDetail({ drill, counterpart }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [holding, setHolding] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const closeFullscreen = useCallback(() => setFullscreen(false), []);
  const storageKey = `${STORAGE_PREFIX}${drill.id}`;
  const labels = useMemo(() => rosterLabels(drill), [drill]);
  const last = drill.steps.length - 1;
  const clock = usePlaybackClock(playing, drill.steps.length, PLAY_INTERVAL_MS);
  useEffect(() => {
    if (!clock.finished) return;
    setPlaying(false);
    setHolding(true);
    setStepIndex(last);
  }, [clock.finished, last]);

  const viewIndex = playing ? clock.index : stepIndex;
  const step = drill.steps[viewIndex];
  const played = playing
    ? playbackFrame(drill.steps, clock.index, clock.t)
    : holding
      ? playbackFrame(drill.steps, last, 1)
      : null;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved && drill.roster.some((r) => r.playerId === saved)) {
        setMyPlayerId(saved);
      }
    } catch {
      // Private mode or storage disabled: position simply isn't remembered.
    }
  }, [storageKey, drill.roster]);

  function choosePosition(playerId: string): void {
    const next = playerId === myPlayerId ? null : playerId;
    setMyPlayerId(next);
    try {
      if (next) window.localStorage.setItem(storageKey, next);
      else window.localStorage.removeItem(storageKey);
    } catch {
      // Storage unavailable: selection still applies for this visit.
    }
  }

  function showStep(index: number): void {
    setHolding(false);
    setPlaying(false);
    setStepIndex(index);
  }

  function play(): void {
    setHolding(false);
    setStepIndex(0);
    setPlaying(true);
  }

  const roleByPlayer = new Map(step.roles.map((r) => [r.playerId, r.text]));

  const diagram = () => (
    <PoolDiagram
      frame={played?.frame ?? step.frame}
      positions={played?.positions}
      ballAt={played?.ballAt}
      playback={playing || holding}
      labels={labels}
      selectedPlayerId={myPlayerId ?? undefined}
      title={`Stap ${viewIndex + 1}: ${step.title}`}
    />
  );
  const stepper = () => (
    <DrillStepper
      steps={drill.steps}
      viewIndex={viewIndex}
      last={last}
      title={step.title}
      onPrev={() => showStep(Math.max(0, viewIndex - 1))}
      onNext={() => showStep(Math.min(last, viewIndex + 1))}
    />
  );
  const playButton = () => (
    <Button
      variant="primary"
      className="flex-1"
      onClick={playing ? () => showStep(viewIndex) : play}
    >
      {playing ? "Stop animatie" : "▶ Speel animatie"}
    </Button>
  );

  return (
    <main>
      <div className="container" hidden={fullscreen}>
        <AppBar title={drill.title} fallbackHref="/speelboek" />

        <div className="flex flex-wrap gap-1.5 mb-3">
          <span className="badge">{CATEGORY_LABELS[drill.category]}</span>
          <span className="badge">Niveau: {LEVEL_LABELS[drill.level]}</span>
          <span className="badge">
            {drill.steps.length} {drill.steps.length === 1 ? "stap" : "stappen"}
          </span>
          {!drill.published ? (
            <span className="badge">Concept – alleen via de link</span>
          ) : null}
        </div>

        <div className="speelboek-pool">{diagram()}</div>
        <DiagramLegend attackColor={step.frame.attackColor} />
        {stepper()}

        <div className="card">
          <p className="m-0 text-[14px]">{step.text}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {playButton()}
          <Button
            variant="secondary"
            className="flex-1 basis-[140px]"
            onClick={() => setFullscreen(true)}
          >
            Volledig scherm
          </Button>
          {counterpart ? (
            <Link
              href={`/speelboek/${counterpart.id}` as Route}
              className="ui-btn flex-1"
              data-variant="secondary"
            >
              {counterpart.category === "VERDEDIGING"
                ? "Verdediging-weergave"
                : "Aanval-weergave"}
            </Link>
          ) : null}
        </div>

        <h2 className="speelboek-section">
          Rol per positie in deze stap
          {myPlayerId ? (
            <span className="speelboek-section-note">
              · jij speelt {labels[myPlayerId]}
            </span>
          ) : (
            <span className="speelboek-section-note">
              · tik op jouw positie
            </span>
          )}
        </h2>
        <div className="card p-2">
          <ul className="speelboek-roles">
            {drill.roster.map((entry) => {
              const role = roleByPlayer.get(entry.playerId);
              const mine = entry.playerId === myPlayerId;
              return (
                <li key={entry.playerId} data-mine={mine ? "true" : undefined}>
                  <button
                    type="button"
                    aria-pressed={mine}
                    aria-label={`${entry.name}${mine ? ", jouw positie" : ""}`}
                    onClick={() => choosePosition(entry.playerId)}
                  >
                    <span
                      className="speelboek-cap"
                      data-cap={rosterCapTone(entry.playerId, step.frame)}
                      aria-hidden="true"
                    >
                      {entry.label}
                    </span>
                    <span className="min-w-0">
                      <span className="speelboek-role-pos">
                        {entry.name}
                        {mine ? " · jij" : ""}
                      </span>
                      {role ?? (
                        <span className="muted">Geen specifieke taak.</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {drill.keyPoints.length > 0 ? (
          <>
            <h2 className="speelboek-section">Let op</h2>
            <div className="card">
              <ul className="m-0 pl-[18px] text-[14px]">
                {drill.keyPoints.map((point) => (
                  <li key={point} className="my-1">
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}

        {drill.commonMistakes.length > 0 ? (
          <>
            <h2 className="speelboek-section">Veelgemaakte fouten</h2>
            <div className="card">
              <ul className="m-0 pl-[18px] text-[14px]">
                {drill.commonMistakes.map((mistake) => (
                  <li key={mistake} className="my-1">
                    {mistake}
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}

        <DrillEngagementPanel drillId={drill.id} source={drill.source} />

        {counterpart ? (
          <p className="muted text-xs mt-2">
            Tegenhanger:{" "}
            <Link href={`/speelboek/${counterpart.id}` as Route}>
              {counterpart.title}
            </Link>
          </p>
        ) : null}
      </div>
      {fullscreen
        ? createPortal(
            <DrillFullscreen
              title={drill.title}
              onClose={closeFullscreen}
              diagram={diagram()}
              stepper={stepper()}
              legend={<DiagramLegend attackColor={step.frame.attackColor} />}
              text={step.text}
              playButton={playButton()}
            />,
            document.body,
          )
        : null}
    </main>
  );
}

function DrillFullscreen({
  title,
  onClose,
  diagram,
  legend,
  stepper,
  text,
  playButton,
}: {
  title: string;
  onClose: () => void;
  diagram: ReactNode;
  legend: ReactNode;
  stepper: ReactNode;
  text: string;
  playButton: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(dialogRef, onClose);
  useEffect(() => {
    const node = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let enteredNative = false;
    const onFullscreenChange = () => {
      if (document.fullscreenElement === node) enteredNative = true;
      else if (enteredNative) onClose();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    void node?.requestFullscreen?.().catch(() => undefined);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (document.fullscreenElement === node) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, [onClose]);

  return (
    <div
      ref={dialogRef}
      className="speelboek-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label="Volledig scherm"
      tabIndex={-1}
    >
      <div className="speelboek-fullscreen-bar">
        <strong className="min-w-0 truncate">{title}</strong>
        <button
          type="button"
          className="speelboek-stepper-nav"
          aria-label="Sluit volledig scherm"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="speelboek-fullscreen-body">
        <div className="speelboek-fullscreen-stage">
          <div className="speelboek-pool">{diagram}</div>
        </div>
        <div className="speelboek-fullscreen-controls">
          {legend}
          {stepper}
          <p className="speelboek-fullscreen-text">{text}</p>
          <div className="flex gap-2">{playButton}</div>
        </div>
      </div>
    </div>
  );
}

function DrillStepper({
  steps,
  viewIndex,
  last,
  title,
  onPrev,
  onNext,
}: {
  steps: Drill["steps"];
  viewIndex: number;
  last: number;
  title: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="speelboek-stepper" aria-live="polite">
      <button
        type="button"
        className="speelboek-stepper-nav"
        aria-label="Vorige stap"
        disabled={viewIndex === 0}
        onClick={onPrev}
      >
        ‹
      </button>
      <div className="text-center min-w-0">
        <div className="font-semibold">
          Stap {viewIndex + 1} van {steps.length} · {title}
        </div>
        <div className="speelboek-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <i key={s.title} data-on={i === viewIndex ? "true" : undefined} />
          ))}
        </div>
      </div>
      <button
        type="button"
        className="speelboek-stepper-nav"
        aria-label="Volgende stap"
        disabled={viewIndex === last}
        onClick={onNext}
      >
        ›
      </button>
    </div>
  );
}

function DiagramLegend({
  attackColor,
}: {
  attackColor: Drill["steps"][number]["frame"]["attackColor"];
}) {
  const attack = attackColor === "WHITE" ? "wit" : "blauw";
  const defence = attackColor === "WHITE" ? "blauw" : "wit";
  return (
    <ul className="speelboek-legend" aria-label="Legenda">
      <li>
        <i data-cap={attackColor === "WHITE" ? "white" : "blue"} /> Aanval (
        {attack})
      </li>
      <li>
        <i data-cap={attackColor === "WHITE" ? "blue" : "white"} /> Verdediging
        ({defence})
      </li>
      <li>
        <i data-cap="red" /> Keeper
      </li>
      <li>
        <i data-cap="ball" /> Bal
      </li>
      <li>
        <i data-line="move" /> Actie
      </li>
      <li>
        <i data-line="pass" /> Pass
      </li>
    </ul>
  );
}
