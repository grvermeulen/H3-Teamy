"use client";

import { useEffect, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { ButtonName } from "@/lib/cityArena/input/inputState";
import type { TouchLook } from "@/lib/cityArena/input/touchLook";
import { capturePointer } from "./TouchStick";

/** Fire button label (spec §16). */
export const FIRE_LABEL = "Schieten";
/** Car button label while on foot (spec §16). */
export const ENTER_LABEL = "Instappen";
/** Car button label while driving (spec §16). */
export const EXIT_LABEL = "Uitstappen";
/** The same button at the brewery's tap, where a press orders a beer instead. */
export const BEER_LABEL = "Biertje";
/** Weapon button label (spec §16). */
export const WEAPON_LABEL = "Wapen";
/** Radio button label, shown in a car (Plan 7). */
export const RADIO_LABEL = "Radio";
/** The 3D sights toggle's label (aim round §6): aiming down the sights. */
export const SIGHTS_LABEL = "Richten";
/** Same rules as Space Invaders' touch buttons: ≥ 58 px, `touch-manipulation`, nothing selectable. */
const TOUCH_BUTTON_CLASS =
  "min-h-[58px] min-w-[96px] touch-manipulation rounded-[10px] bg-white/10 px-3 text-base font-semibold text-white select-none active:bg-white/25 [-webkit-user-select:none] [-webkit-touch-callout:none]";
/** The 3D fire button: big and round under the right thumb. */
const FIRE_BUTTON_CLASS =
  "flex h-[88px] w-[88px] touch-none flex-col items-center justify-center gap-0.5 rounded-full border-2 border-white/40 bg-red-600/45 text-[11px] font-semibold text-white select-none active:bg-red-600/75 [-webkit-user-select:none] [-webkit-touch-callout:none]";
/** The 3D sights toggle above it; amber while the sights are up. */
const SIGHTS_BUTTON_CLASS =
  "flex h-14 w-14 touch-manipulation flex-col items-center justify-center rounded-full border-2 border-white/40 bg-white/10 text-[10px] font-semibold text-white select-none aria-pressed:border-[var(--arena-amber)] aria-pressed:bg-[var(--arena-amber)] aria-pressed:text-[var(--arena-void)] disabled:opacity-40 [-webkit-user-select:none] [-webkit-touch-callout:none]";

/** Props for {@link ArenaTouchButtons}. */
export type ArenaTouchButtonsProps = {
  inVehicle: boolean;
  /** True at the brewery's tap: the Instappen button reads Biertje. Defaults to false. */
  canOrderBeer?: boolean;
  /** Action offered by the nearby landmark. */
  interactionLabel?: string;
  onButton: (name: ButtonName, pressed: boolean) => void;
  /** False with the twin-stick layout, where the aim stick fires (spec §7). Defaults to true. */
  showFire?: boolean;
  /** Switches the radio station; the button shows in a car, and only when there is a radio. */
  onRadio?: () => void;
  /**
   * The 3D look pad, given on touch in 3D only (aim round §6): Schieten becomes the big
   * hold-to-fire button whose drag also turns the camera, with the Richten toggle above it.
   */
  look?: TouchLook;
  /** A gun in hand and alive: otherwise Richten is off and disabled. Defaults to true. */
  sightsAllowed?: boolean;
};

/** Enter and Space are the DOM's native button-activation keys. */
const isActivationKey = (key: string): boolean =>
  key === "Enter" || key === " ";

/** The press and release handlers a held button shares between pointer and keyboard. */
type HoldHandlers = {
  press: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  release: () => void;
  pressOnKey: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  releaseOnKey: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
};

/** Reports `name` pressed from a pointer down or an activation key, released on up. */
function holdHandlers(
  name: ButtonName,
  onButton: (name: ButtonName, pressed: boolean) => void,
): HoldHandlers {
  const release = (): void => onButton(name, false);
  return {
    press(event) {
      event.preventDefault();
      onButton(name, true);
    },
    release,
    pressOnKey(event) {
      if (!isActivationKey(event.key)) return;
      // Stop the browser's synthetic click (and Space's page scroll) so the
      // key only ever drives the press/release pair below.
      event.preventDefault();
      if (event.repeat) return;
      onButton(name, true);
    },
    releaseOnKey(event) {
      if (isActivationKey(event.key)) release();
    },
  };
}

/** Props for {@link HoldButton}. */
type HoldButtonProps = {
  name: ButtonName;
  label: string;
  onButton: (name: ButtonName, pressed: boolean) => void;
};

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
  const hold = holdHandlers(name, onButton);
  return (
    <button
      type="button"
      className={TOUCH_BUTTON_CLASS}
      onPointerDown={hold.press}
      onPointerUp={hold.release}
      onPointerLeave={hold.release}
      onPointerCancel={hold.release}
      onKeyDown={hold.pressOnKey}
      onKeyUp={hold.releaseOnKey}
      onBlur={hold.release}
      onContextMenu={(event) => event.preventDefault()}
    >
      {label}
    </button>
  );
}

/** A round of ammunition, the fire button's icon. */
function RoundIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-7 w-7 fill-current"
    >
      <path d="M12 2c2.2 2.2 3.3 4.8 3.3 7.6V19H8.7V9.6C8.7 6.8 9.8 4.2 12 2z" />
      <rect x="7.7" y="20" width="8.6" height="2" rx="0.5" />
    </svg>
  );
}

/** A scope's reticle, the sights toggle's icon. */
function ScopeIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6 fill-none stroke-current [stroke-linecap:round] [stroke-width:2]"
    >
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6" />
    </svg>
  );
}

/** Props for {@link FireButton}. */
type FireButtonProps = {
  onButton: (name: ButtonName, pressed: boolean) => void;
  look: TouchLook;
};

/**
 * The 3D fire button (aim round §6): held, it fires; a drag that starts on it also turns the
 * camera through the look pad, so one thumb can keep firing while it tracks a target. The pointer
 * is captured, so the thumb may wander off the button without letting go of the trigger.
 */
function FireButton({ onButton, look }: FireButtonProps): React.JSX.Element {
  const hold = holdHandlers("fire", onButton);
  const letGo = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    hold.release();
    look.onUp(event);
  };
  return (
    <button
      type="button"
      className={FIRE_BUTTON_CLASS}
      onPointerDown={(event) => {
        hold.press(event);
        look.onDown(event);
        capturePointer(event);
      }}
      onPointerMove={(event) => look.onMove(event)}
      onPointerUp={letGo}
      onPointerCancel={letGo}
      onLostPointerCapture={letGo}
      onKeyDown={hold.pressOnKey}
      onKeyUp={hold.releaseOnKey}
      onBlur={hold.release}
      onContextMenu={(event) => event.preventDefault()}
    >
      <RoundIcon />
      {FIRE_LABEL}
    </button>
  );
}

/**
 * The sights toggle's state: up from a tap until the next, and put down — not just paused — when
 * they stop being allowed or the page is hidden (the input is cleared then). While up it holds the
 * `buttons` source of `ads`; it lets go when the buttons go away.
 */
function useSights(
  onButton: (name: ButtonName, pressed: boolean) => void,
  allowed: boolean,
): { up: boolean; toggle: () => void } {
  const [on, setOn] = useState(false);
  const up = on && allowed;
  useEffect(() => {
    if (!allowed) setOn(false);
  }, [allowed]);
  useEffect(() => {
    onButton("ads", up);
    return () => onButton("ads", false);
  }, [onButton, up]);
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden) setOn(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  return { up, toggle: () => setOn((current) => !current) };
}

/** The Richten toggle (aim round §6): a tap puts the sights up or down; pressed while up. */
function SightsToggle({
  onButton,
  allowed,
}: {
  onButton: (name: ButtonName, pressed: boolean) => void;
  allowed: boolean;
}): React.JSX.Element {
  const sights = useSights(onButton, allowed);
  return (
    <button
      type="button"
      aria-pressed={sights.up}
      disabled={!allowed}
      className={SIGHTS_BUTTON_CLASS}
      onClick={sights.toggle}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ScopeIcon />
      {SIGHTS_LABEL}
    </button>
  );
}

/** Radio (in a car, with a radio), Wapen and Instappen/Uitstappen/Biertje, top to bottom. */
function CarAndWeaponButtons({
  inVehicle,
  canOrderBeer = false,
  interactionLabel,
  onButton,
  onRadio,
}: ArenaTouchButtonsProps): React.JSX.Element {
  const enterLabel = inVehicle
    ? EXIT_LABEL
    : canOrderBeer
      ? BEER_LABEL
      : (interactionLabel ?? ENTER_LABEL);
  return (
    <>
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
      <HoldButton name="enter" label={enterLabel} onButton={onButton} />
    </>
  );
}

/**
 * Wapen, Instappen/Uitstappen and — with a single stick — Schieten, stacked at the bottom right
 * above the footer (spec §7), with Radio on top while in a car (Plan 7). In 3D on touch the round
 * Schieten button sits in the corner under the thumb with Richten above it, and the others move to
 * their left (aim round §6). Above the aim surface and the look pad in stacking order, so a thumb
 * on a button never starts the surface underneath.
 */
export default function ArenaTouchButtons(
  props: ArenaTouchButtonsProps,
): React.JSX.Element {
  const { onButton, showFire = true, look, sightsAllowed = true } = props;
  if (!look)
    return (
      <div
        data-testid="arena-touch-buttons"
        className="absolute right-3 bottom-3 z-10 flex flex-col gap-2"
      >
        <CarAndWeaponButtons {...props} />
        {showFire ? (
          <HoldButton name="fire" label={FIRE_LABEL} onButton={onButton} />
        ) : null}
      </div>
    );
  return (
    <div
      data-testid="arena-touch-buttons"
      className="absolute right-3 bottom-3 z-10 flex items-end gap-3"
    >
      <div className="flex flex-col gap-2">
        <CarAndWeaponButtons {...props} />
      </div>
      <div className="flex flex-col items-center gap-3">
        <SightsToggle onButton={onButton} allowed={sightsAllowed} />
        <FireButton onButton={onButton} look={look} />
      </div>
    </div>
  );
}
