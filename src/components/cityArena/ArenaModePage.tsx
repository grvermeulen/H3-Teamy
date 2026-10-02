"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "../SessionContext";
import {
  ArenaRoomCodeSchema,
  type ArenaRole,
} from "@/lib/cityArena/net/roomProtocol";
import { DEFAULT_ARENA_SETTINGS } from "@/lib/cityArena/schemas";
import { ArenaNewGame } from "./ArenaNewGame";
import type { ArenaEntry } from "./arenaEntry";

const ArenaController = dynamic(
  () => import("./ArenaController").then((module) => module.ArenaController),
  { ssr: false },
);
const ArenaScreen = dynamic(
  () => import("./ArenaScreen").then((module) => module.ArenaScreen),
  { ssr: false },
);
const CityArenaOverlay = dynamic(() => import("./CityArenaOverlay"), {
  ssr: false,
});

/** Entry form shared by TV, controller QR links and the launcher mode selector. */
export function ArenaModePage({
  defaultRole,
}: {
  defaultRole: ArenaRole;
}): React.JSX.Element {
  const session = useSession();
  const [role, setRole] = useState(defaultRole);
  const [code, setCode] = useState("");
  const [entry, setEntry] = useState<ArenaEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("/arena/controller");
  useEffect(() => {
    setCode(
      new URLSearchParams(window.location.search)
        .get("code")
        ?.toUpperCase()
        .trim() ?? "",
    );
    setCallbackUrl(window.location.pathname + window.location.search);
  }, []);
  const close = (): void => setEntry(null);
  if (entry?.role === "display")
    return <ArenaScreen entry={entry} onClose={close} />;
  if (entry && session.loggedIn)
    return entry.role === "controller" ? (
      <ArenaController entry={entry} onClose={close} />
    ) : (
      <CityArenaOverlay entry={entry} onClose={close} onNewGame={close} />
    );
  const allowed = role === "display" || (!session.loading && session.loggedIn);
  return (
    <section className="arena mx-auto my-6 max-w-2xl rounded-xl border border-[var(--arena-line)] bg-[var(--arena-void)] p-5 text-[var(--arena-text)] sm:p-8">
      <p className="arena-label text-[var(--arena-amber)]">
        GTA H3 · Samen spelen
      </p>
      <h1 className="arena-display mt-2 text-3xl">
        {defaultRole === "display"
          ? "Speel op het grote scherm"
          : "Kies hoe je meespeelt"}
      </h1>
      <p className="mt-3 text-sm text-[var(--arena-dim)]">
        {defaultRole === "display"
          ? "Open een kamer en laat spelers de QR-code scannen. Of voer de code van een bestaande kamer in. Op dit scherm hoef je niet in te loggen."
          : "Gebruik je eigen spelbeeld of speel met je telefoon als controller voor de tv."}
      </p>
      {defaultRole !== "display" ? (
        <label className="mt-5 block text-sm">
          Speelstand
          <select
            aria-label="Speelstand"
            value={role}
            onChange={(event) => setRole(event.target.value as ArenaRole)}
            className="mt-2 min-h-12 w-full rounded border border-[var(--arena-line)] bg-[var(--arena-panel)] px-3"
          >
            <option value="player">Speler · eigen beeld</option>
            <option value="controller">Controller · kijk naar de tv</option>
            <option value="hybrid">
              Scherm + controller · spiegel je telefoon
            </option>
          </select>
        </label>
      ) : null}
      {!allowed ? (
        <div className="mt-5 rounded border border-[var(--arena-line)] p-4">
          <p>Log in met je H3-account om mee te spelen.</p>
          <Link
            className="mt-3 inline-block min-h-11 rounded bg-[var(--arena-amber)] px-4 py-3 text-[var(--arena-void)]"
            href={{ pathname: "/login", query: { callbackUrl } }}
          >
            Inloggen en verdergaan
          </Link>
        </div>
      ) : null}
      <form
        className="mt-5 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = ArenaRoomCodeSchema.safeParse(
            code.trim().toUpperCase(),
          );
          if (!parsed.success) {
            setError("Voer de code van zes tekens in");
            return;
          }
          setError(null);
          setEntry({
            kind: "join",
            roomCode: parsed.data,
            zone: DEFAULT_ARENA_SETTINGS.lastZone,
            role,
          });
        }}
      >
        <label className="min-w-0 flex-1 text-sm">
          Kamercode
          <input
            aria-label="Kamercode"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={6}
            placeholder="ABC234"
            className="mt-2 min-h-12 w-full rounded border border-[var(--arena-line)] bg-[var(--arena-panel)] px-3 text-2xl tracking-widest"
          />
        </label>
        <button
          disabled={!allowed}
          className="min-h-12 rounded bg-[var(--arena-amber)] px-5 text-[var(--arena-void)] disabled:opacity-40"
        >
          {role === "display" ? "Scherm verbinden" : "Meedoen"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-[var(--arena-alert)]">
          {error}
        </p>
      ) : null}
      <ArenaNewGame
        disabled={!allowed}
        onStart={(zone) => setEntry({ kind: "new", zone, role })}
      />
      <div className="mt-6 space-y-2 text-sm text-[var(--arena-dim)]">
        <p>
          Tv: open deze pagina in de tv-browser, sluit een laptop aan met HDMI
          of cast het tabblad vanuit Chrome.
        </p>
        <p>
          Telefoon spiegelen: kies Scherm + controller, draai je telefoon en
          gebruik AirPlay of schermspiegeling. Hetzelfde beeld staat dan op je
          telefoon en de tv.
        </p>
        <p>
          Een gamepad bestuurt één ingelogde speler. Druk op een knop om hem te
          activeren.
        </p>
        <Link href="/" className="inline-block min-h-11 py-3 underline">
          Terug naar H3
        </Link>
      </div>
    </section>
  );
}
