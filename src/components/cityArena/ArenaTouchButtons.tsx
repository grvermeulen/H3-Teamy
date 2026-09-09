"use client";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { ButtonName } from "@/lib/cityArena/input/inputState";

/** Fire button label (spec §16). */
export const FIRE_LABEL = "Schieten";
/** Car button label while on foot (spec §16). */
export const ENTER_LABEL = "Instappen";
/** Car button label while driving (spec §16). */
export const EXIT_LABEL = "Uitstappen";
/** Weapon button label (spec §16). */
export const WEAPON_LABEL = "Wapen";
/** Radio button label, shown in a car (Plan 7). */
export const RADIO_LABEL = "Radio";
/** Same rules as Space Invaders' touch buttons: ≥ 58 px, `touch-manipulation`, nothing selectable. */
const TOUCH_BUTTON_CLASS =
  "min-h-[58px] min-w-[96px] touch-manipulation rounded-[10px] bg-white/10 px-3 text-base font-semibold text-white select-none active:bg-white/25 [-webkit-user-select:none] [-webkit-touch-callout:none]";

/** Props for {@link ArenaTouchButtons}. */
export type ArenaTouchButtonsProps = {
  inVehicle: boolean;
  onButton: (name: ButtonName, pressed: boolean) => void;
  /** False with the twin-stick layout, where the aim stick fires (spec §7). Defaults to true. */
  showFire?: boolean;
  /** Switches the radio station; the button shows in a car, and only when there is a radio. */
  onRadio?: () => void;
};

/** Props for {@link HoldButton}. */
type HoldButtonProps = {
  name: ButtonName;
  label: string;
  onButton: (name: ButtonName, pressed: boolean) => void;
};

/** Enter and Space are the DOM's native button-activation keys. */
const isActivationKey = (key: string): boolean =>
  key === "Enter" || key === " ";

/**
 * A button that reports `pressed` while held and releases on up, leave or
 * cancel. Pointer and keyboard (Enter/Space) both drive the same press/release
 * semantics so keyboard and screen-reader users can hold it too; losing focus
 * releases as well, so a key held while tabbing away cannot stick.
 */
function HoldButton({
  name,
  label,
  onButton,
}: HoldButtonProps): React.JSX.Element {
  const press = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    onButton(name, true);
  };
  const release = (): void => onButton(name, false);
  const pressOnKey = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!isActivationKey(event.key)) return;
    // Stop the browser's synthetic click (and Space's page scroll) so the
    // key only ever drives the press/release pair below.
    event.preventDefault();
    if (event.repeat) return;
    onButton(name, true);
  };
  const releaseOnKey = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (isActivationKey(event.key)) release();
  };
  return (
    <button
      type="button"
      className={TOUCH_BUTTON_CLASS}
      onPointerDown={press}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onKeyDown={pressOnKey}
      onKeyUp={releaseOnKey}
      onBlur={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      {label}
    </button>
  );
}

/**
 * Wapen, Instappen/Uitstappen and — with a single stick — Schieten, stacked at the bottom right
 * above the footer (spec §7), with Radio on top while in a car (Plan 7). Above the aim surface in
 * stacking order, so a thumb on a button never starts the stick underneath.
 */
export default function ArenaTouchButtons({
  inVehicle,
  onButton,
  showFire = true,
  onRadio,
}: ArenaTouchButtonsProps): React.JSX.Element {
  return (
    <div
      data-testid="arena-touch-buttons"
      className="absolute right-3 bottom-3 z-10 flex flex-col gap-2"
    >
      {inVehicle && onRadio ? (
        <button
          type="button"
          className={TOUCH_BUTTON_CLASS}
          onClick={onRadio}
          onContextMenu={(event) => event.preventDefault()}
        >
          {RADIO_LABEL}
        </button>
      ) : null}
      <HoldButton name="weaponNext" label={WEAPON_LABEL} onButton={onButton} />
      <HoldButton
        name="enter"
        label={inVehicle ? EXIT_LABEL : ENTER_LABEL}
        onButton={onButton}
      />
      {showFire ? (
        <HoldButton name="fire" label={FIRE_LABEL} onButton={onButton} />
      ) : null}
    </div>
  );
}
