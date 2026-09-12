"use client";

/** Props for the wanted-level indicator. */
export type ArenaWantedProps = { wantedLevel: number };

/** Accessible Dutch wanted stars. */
export default function ArenaWanted({
  wantedLevel,
}: ArenaWantedProps): React.JSX.Element {
  const level = Math.max(0, Math.min(3, Math.floor(wantedLevel)));
  return (
    <span data-testid="arena-wanted" aria-label={`Gezocht: ${level} sterren`}>
      <span>Gezocht: {level} sterren</span>{" "}
      <span aria-hidden="true" className="text-[#f0b429]">
        {[0, 1, 2].map((star) => (star < level ? "★" : "☆")).join("")}
      </span>
    </span>
  );
}
