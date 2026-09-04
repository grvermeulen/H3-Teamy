"use client";

import { useCallback, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  STICK_RADIUS_PX,
  type StickController,
  type StickState,
} from "@/lib/cityArena/input/touchStick";

/** Props for {@link TouchStick}. */
type TouchStickProps = {
  stick: StickController;
  onVector: (vector: [number, number] | null) => void;
};

/** Radius of the knob circle: half the stick's travel radius. */
const STICK_KNOB_RADIUS_PX = STICK_RADIUS_PX / 2;

/** Pointer position in CSS pixels relative to the surface the event fired on. */
function localPoint(
  event: ReactPointerEvent<HTMLDivElement>,
): [number, number] {
  const rect = event.currentTarget.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

/** Captures the pointer on the surface so a drag past its edge keeps tracking. */
function capturePointer(event: ReactPointerEvent<HTMLDivElement>): void {
  if (typeof event.currentTarget.setPointerCapture === "function") {
    event.currentTarget.setPointerCapture(event.pointerId);
  }
}

/** Pointer handlers plus the live stick state they drive. */
type StickHandlers = {
  state: StickState;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

/** Wires pointer events on the stick surface to a {@link StickController} and `onVector`. */
function useStickHandlers(
  stick: StickController,
  onVector: (vector: [number, number] | null) => void,
): StickHandlers {
  const [state, setState] = useState<StickState>(stick.state());

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (stick.state().pointerId !== null) return;
      const [x, y] = localPoint(event);
      stick.begin(event.pointerId, x, y);
      capturePointer(event);
      setState(stick.state());
    },
    [stick],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const [x, y] = localPoint(event);
      stick.move(event.pointerId, x, y);
      const next = stick.state();
      setState(next);
      if (next.pointerId === event.pointerId) onVector(next.vector);
    },
    [onVector, stick],
  );

  const onPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const owner = stick.state().pointerId;
      stick.end(event.pointerId);
      setState(stick.state());
      if (owner === event.pointerId) onVector(null);
    },
    [onVector, stick],
  );

  return { state, onPointerDown, onPointerMove, onPointerEnd };
}

/** Props for {@link StickGraphic}. */
type StickGraphicProps = { state: StickState };

/** SVG base-and-knob circles positioned via `cx`/`cy`; empty while no finger is down. */
function StickGraphic({ state }: StickGraphicProps): React.JSX.Element {
  if (!state.origin || !state.knob) {
    return (
      <svg className="pointer-events-none h-full w-full" aria-hidden="true" />
    );
  }
  return (
    <svg className="pointer-events-none h-full w-full" aria-hidden="true">
      <circle
        data-testid="touch-stick-base"
        cx={state.origin[0]}
        cy={state.origin[1]}
        r={STICK_RADIUS_PX}
        className="fill-white/10 stroke-white/50 [stroke-width:2]"
      />
      <circle
        data-testid="touch-stick-knob"
        cx={state.knob[0]}
        cy={state.knob[1]}
        r={STICK_KNOB_RADIUS_PX}
        className="fill-white/70"
      />
    </svg>
  );
}

/**
 * Floating joystick surface on the left part of the screen. The base and knob are SVG circles
 * whose `cx`/`cy` attributes track the finger — not inline styles, and not the CSS-custom-property
 * idiom either, because Space Invaders' touch controls (`src/components/spaceInvaders/`) are static
 * buttons with no moving part to mirror; SVG geometry attributes are the closest existing pattern
 * that avoids `style` props. The surface is `aria-hidden`: it is a touch-only convenience layer,
 * and keyboard input (`src/lib/cityArena/input/keyboard.ts`) is the accessible equivalent.
 */
export default function TouchStick({
  stick,
  onVector,
}: TouchStickProps): React.JSX.Element {
  const { state, onPointerDown, onPointerMove, onPointerEnd } =
    useStickHandlers(stick, onVector);

  return (
    <div
      data-testid="touch-stick-surface"
      aria-hidden="true"
      className="absolute inset-y-0 left-0 w-[45%] touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={(event) => event.preventDefault()}
    >
      <StickGraphic state={state} />
    </div>
  );
}
