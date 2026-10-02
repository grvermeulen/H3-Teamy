"use client";

/** Props for the persisted sound checkbox. */
export type ArenaSoundToggleProps = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

/** Presentational, keyboard-accessible Dutch sound setting. */
export default function ArenaSoundToggle({
  enabled,
  onChange,
}: ArenaSoundToggleProps): React.JSX.Element {
  return (
    <label className="flex items-center gap-1 text-xs">
      <input
        type="checkbox"
        aria-label="Geluid"
        checked={enabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>Geluid</span>
    </label>
  );
}
