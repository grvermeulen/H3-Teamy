"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MissionHud } from "@/lib/cityArena/missions/hud";
import type {
  MissionCommand,
  MissionDefinition,
} from "@/lib/cityArena/missions/types";
import type { Point } from "@/lib/cityArena/world/projection";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

type Action = (command: Omit<MissionCommand, "sequence">) => void;
const button =
  "min-h-11 rounded border border-white/25 px-2 py-1 text-xs hover:bg-white/15 disabled:opacity-40 sm:min-h-8";

function Briefing({
  offer,
  onAction,
}: {
  offer: MissionDefinition;
  onAction: Action;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onAction({ kind: "close" }), [onAction]);
  useDialogFocusTrap(ref, close);
  useEffect(() => {
    let previous = [true, true];
    const interval = setInterval(() => {
      const pad = navigator
        .getGamepads?.()
        .find(
          (candidate) =>
            candidate?.connected && candidate.mapping === "standard",
        );
      const pressed = [0, 1].map(
        (index) => (pad?.buttons[index]?.value ?? 0) > 0.5,
      );
      if (pressed[0] && !previous[0])
        onAction({ kind: "accept", missionId: offer.id });
      else if (pressed[1] && !previous[1]) close();
      previous = pressed;
    }, 50);
    return () => clearInterval(interval);
  }, [close, offer.id, onAction]);
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mission-offer-title"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-amber-300/40 bg-slate-950 p-5 text-white"
      >
        <h2
          id="mission-offer-title"
          className="text-xl font-bold text-amber-200"
        >
          {offer.title}
        </h2>
        <p className="my-2 text-sm">
          €{offer.basePay} + maximaal €{offer.bonus.amount} bonus · ongeveer{" "}
          {Math.ceil(offer.estimatedSeconds / 60)} minuten
        </p>
        {offer.briefing.map((line, i) => (
          <p key={i} className="my-3 text-sm">
            <strong>{line.speaker}: </strong>
            {line.text}
          </p>
        ))}
        <p className="mb-4 text-xs text-amber-200">
          Bonus: {offer.bonus.label}
        </p>
        <div className="flex gap-3">
          <button
            className={button}
            onClick={() => onAction({ kind: "accept", missionId: offer.id })}
          >
            Aannemen
          </button>
          <button className={button} onClick={close}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

/** Contract briefing, current step, hints, dialogue history and once-only payment receipt. */
export function ArenaMissionPanel({
  mission,
  onAction,
  onRoute,
}: {
  mission: MissionHud;
  onAction: Action;
  onRoute: (point: Point | null) => void;
}): React.JSX.Element {
  const [journal, setJournal] = useState(false);
  const { profile, definition, contact } = mission;
  const run = profile.run;
  const stage = definition && run ? definition.stages[run.stage] : null;
  const receipt = profile.wallet.receipts.find(
    (entry) => entry.contractId === run?.contractId,
  );
  return (
    <>
      <section
        aria-label="Missies en geld"
        className="absolute top-3 left-3 z-10 max-h-[42%] w-[min(20rem,calc(100%-7rem))] overflow-y-auto rounded-lg border border-white/20 bg-slate-950/90 p-3 text-sm text-white shadow-lg"
      >
        <div className="flex items-center justify-between gap-3">
          <strong className="text-emerald-300">
            €{profile.wallet.balance}{" "}
            <span className="text-xs font-normal">
              · verdiend €{profile.wallet.earned}
            </span>
          </strong>
          <button
            className={button}
            aria-expanded={journal}
            onClick={() => setJournal(!journal)}
          >
            Logboek
          </button>
        </div>
        {definition && run && stage ? (
          <div aria-live="polite" className="mt-2">
            <h3 className="font-bold text-amber-200">{definition.title}</h3>
            {run.status === "active" ? (
              <>
                <p className="mt-1">
                  {run.stage + 1}/{definition.stages.length} · {stage.text}
                </p>
                <p className="text-xs text-slate-300">
                  {mission.distanceM !== null ? `${mission.distanceM} m` : ""}
                  {mission.secondsLeft !== null
                    ? ` · ${mission.secondsLeft} s over`
                    : ""}
                </p>
                <p className="my-2 text-xs">
                  <strong>{stage.dialogue[0].speaker}: </strong>
                  {stage.dialogue[0].text}
                </p>
                {mission.meters?.map((meter) => (
                  <label key={meter.label} className="my-2 block text-xs">
                    {meter.label}: {Math.floor(meter.value)}/{meter.max}
                    <progress
                      className="block h-2 w-full accent-amber-300"
                      value={meter.value}
                      max={meter.max}
                    />
                  </label>
                ))}
                {stage.hints.slice(0, run.hint).map((hint) => (
                  <p key={hint} className="my-1 text-xs text-amber-100">
                    Hint: {hint}
                  </p>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button
                    className={button}
                    onClick={() => onAction({ kind: "hint" })}
                  >
                    Hint
                  </button>
                  {mission.destination && (
                    <button
                      className={button}
                      onClick={() => onRoute(mission.destination)}
                    >
                      Route volgen
                    </button>
                  )}
                  {journal && (
                    <button
                      className={button}
                      onClick={() => onAction({ kind: "abandon" })}
                    >
                      Missie stoppen
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="my-2">
                  {run.status === "completed"
                    ? `Voltooid! €${receipt?.base ?? 0} + €${receipt?.bonus ?? 0} bonus ontvangen.`
                    : (run.failure ?? definition.failure)}
                </p>
                {run.status === "completed" ? (
                  <>
                    <p className="text-xs text-amber-200">
                      Medaille:{" "}
                      {profile.records?.[definition.id]?.medal === "gold"
                        ? "goud"
                        : profile.records?.[definition.id]?.medal === "silver"
                          ? "zilver"
                          : "brons"}
                    </p>
                    {definition.success.map((line, i) => (
                      <p key={i} className="text-xs">
                        <strong>{line.speaker}: </strong>
                        {line.text}
                      </p>
                    ))}
                  </>
                ) : run.status === "failed" ? (
                  <button
                    className={button}
                    onClick={() => onAction({ kind: "retry" })}
                  >
                    Opnieuw proberen
                  </button>
                ) : null}
              </>
            )}
            {journal &&
              definition.stages.slice(0, run.stage + 1).map((entry) => (
                <div
                  key={entry.id}
                  className="mt-3 border-t border-white/15 pt-2"
                >
                  <p className="font-semibold">{entry.text}</p>
                  {entry.dialogue.map((line, i) => (
                    <p key={i} className="text-xs">
                      <strong>{line.speaker}: </strong>
                      {line.text}
                    </p>
                  ))}
                </div>
              ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-300">
            Zoek een straatcontact met het €-teken voor werk.
          </p>
        )}
        {contact && run?.status !== "active" && (
          <div className="mt-3">
            <h3 className="font-bold">{contact.name}</h3>
            <p className="my-1 text-xs">{contact.greeting}</p>
            {contact.jobs.map((job) => (
              <div key={job.id} className="mt-2">
                <button
                  className={button}
                  disabled={Boolean(job.unavailable)}
                  onClick={() => onAction({ kind: "offer", missionId: job.id })}
                >
                  {job.title}
                </button>
                {job.unavailable && (
                  <p className="mt-1 text-xs text-slate-300">
                    {job.unavailable}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {mission.action && (
          <p className="mt-2 text-xs text-amber-200">
            E / interactie: {mission.action}
          </p>
        )}
      </section>
      {mission.offer && <Briefing offer={mission.offer} onAction={onAction} />}
    </>
  );
}
