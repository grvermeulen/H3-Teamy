import type { ZoneKey } from "@/lib/cityArena/world/mapTypes";
import { zoneName } from "./launcher/MissionCard";

interface ArenaRoomLocationProps {
  zone: ZoneKey;
  onNewGame?: () => void;
  leaving?: boolean;
}

/** Explains a shared room's fixed starting location and offers a fresh location choice. */
export function ArenaRoomLocation({
  zone,
  onNewGame,
  leaving = false,
}: ArenaRoomLocationProps): React.JSX.Element {
  return (
    <section
      className="mt-3 border-t border-[var(--arena-line)] pt-3 text-sm text-[var(--arena-text)]"
      aria-label="Locatie van dit potje"
    >
      <p className="font-semibold">Startlocatie: {zoneName(zone)}</p>
      <p className="mt-1 text-[var(--arena-dim)]">
        De startlocatie staat vast voor deze kamer. Kies een andere locatie bij
        een nieuw potje.
      </p>
      {onNewGame ? (
        <button
          type="button"
          onClick={onNewGame}
          disabled={leaving}
          className="mt-3 min-h-11 rounded border border-[var(--arena-amber)] px-3 py-2 text-[var(--arena-amber)]"
        >
          {leaving ? "Potje verlaten…" : "Verlaten en andere locatie kiezen"}
        </button>
      ) : null}
    </section>
  );
}
