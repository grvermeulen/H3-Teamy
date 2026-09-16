"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  drawNavigationMap,
  mapWorldPoint,
  type MapView,
  type NavigationMapData,
} from "@/lib/cityArena/render/navigationMap";
import type { RadarSnapshot } from "@/lib/cityArena/render/radar";
import type { Point } from "@/lib/cityArena/world/projection";
import { fromUnits } from "@/lib/cityArena/world/projection";
import { navigationLabel } from "@/lib/cityArena/world/navigation";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import { boundsOf } from "@/lib/cityArena/mapBuild/geometry";

type Props = {
  data: NavigationMapData;
  radar: RadarSnapshot;
  onDestination: (point: Point | null) => void;
  onClose: () => void;
};
type Press = {
  id: number;
  x: number;
  y: number;
  view: MapView;
  moved: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};
const buttonClass =
  "min-h-11 rounded-lg border border-slate-600 bg-slate-900 px-4 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-300";

/** Full-screen street map with long-press routing, drag/zoom controls and a keyboard destination alternative. */
export default function ArenaNavigationMap({
  data,
  radar,
  onDestination,
  onClose,
}: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const press = useRef<Press | null>(null);
  const [view, setView] = useState<MapView>(() => ({
    center: radar.player,
    scale: 0.7,
  }));
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [holding, setHolding] = useState(false);
  useDialogFocusTrap(dialogRef, onClose);

  const cancelPress = useCallback(() => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    press.current = null;
    setHolding(false);
  }, []);
  useEffect(
    () => () => {
      if (press.current?.timer) clearTimeout(press.current.timer);
    },
    [],
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      setSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawNavigationMap(context, size, view, data, radar);
  }, [size, view, data, radar]);

  const zoom = (factor: number): void => {
    cancelPress();
    setView((previous) => ({
      ...previous,
      scale: Math.max(0.025, Math.min(4, previous.scale * factor)),
    }));
  };
  const pointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;
    if (press.current || event.isPrimary === false) {
      cancelPress();
      return;
    }
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const point = mapWorldPoint(view, size, [
      event.clientX - rect.left,
      event.clientY - rect.top,
    ]);
    press.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      view,
      moved: false,
      timer: setTimeout(() => {
        onDestination(point);
        if (press.current) {
          press.current.timer = null;
          press.current.moved = true;
        }
        setHolding(false);
      }, 550),
    };
    setHolding(true);
  };
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const start = press.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) <= 8 && !start.moved) return;
    if (start.timer) clearTimeout(start.timer);
    start.timer = null;
    start.moved = true;
    setHolding(false);
    setView({
      scale: start.view.scale,
      center: [
        start.view.center[0] - dx / start.view.scale,
        start.view.center[1] - dy / start.view.scale,
      ],
    });
  };
  const route = radar.navigation;
  const showOverview = (): void => {
    cancelPress();
    const bounds = route?.points.length
      ? boundsOf([...route.points, radar.player])
      : {
          minX: fromUnits(data.index.bounds.minX),
          minY: fromUnits(data.index.bounds.minY),
          maxX: fromUnits(data.index.bounds.maxX),
          maxY: fromUnits(data.index.bounds.maxY),
        };
    setView({
      center: [
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
      ],
      scale: Math.max(
        0.025,
        Math.min(
          4,
          (size.width - 80) / Math.max(100, bounds.maxX - bounds.minX),
          (size.height - 80) / Math.max(100, bounds.maxY - bounds.minY),
        ),
      ),
    });
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Route plannen"
      tabIndex={-1}
      className="absolute inset-0 z-50 flex flex-col bg-[#0c171d] text-slate-100 pt-safe pb-[env(safe-area-inset-bottom)] pl-safe pr-safe"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 px-4 py-3">
        <div>
          <h2 className="font-semibold">Route plannen</h2>
          <p className="text-xs text-slate-400">
            Houd een straat ingedrukt om je bestemming te kiezen.
          </p>
        </div>
        <button
          type="button"
          className={buttonClass}
          onClick={onClose}
          aria-label="Kaart sluiten"
        >
          Terug
        </button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block h-full w-full touch-none cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-300"
          aria-label="Stratenkaart"
          aria-describedby="map-instructions"
          tabIndex={0}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onLostPointerCapture={cancelPress}
          onContextMenu={(event) => event.preventDefault()}
          onWheel={(event) => {
            event.stopPropagation();
            zoom(event.deltaY < 0 ? 1.2 : 1 / 1.2);
          }}
          onKeyDown={(event) => {
            const shifts: Record<string, Point> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            };
            const shift = shifts[event.key];
            if (shift) {
              event.preventDefault();
              cancelPress();
              setView((previous) => ({
                ...previous,
                center: [
                  previous.center[0] + (shift[0] * 80) / previous.scale,
                  previous.center[1] + (shift[1] * 80) / previous.scale,
                ],
              }));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              onDestination(view.center);
            }
            if (event.key === "+" || event.key === "=") {
              event.preventDefault();
              zoom(1.4);
            }
            if (event.key === "-") {
              event.preventDefault();
              zoom(1 / 1.4);
            }
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl text-white/40"
        >
          +
        </div>
        <span className="pointer-events-none absolute left-4 top-4 rounded bg-slate-950/80 px-3 py-2 text-xs">
          N ↑
        </span>
        <div className="absolute right-3 top-3 flex flex-col gap-2">
          <button
            type="button"
            className={buttonClass}
            aria-label="Inzoomen"
            onClick={() => zoom(1.5)}
          >
            +
          </button>
          <button
            type="button"
            className={buttonClass}
            aria-label="Uitzoomen"
            onClick={() => zoom(1 / 1.5)}
          >
            −
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              cancelPress();
              setView({ center: radar.player, scale: 0.7 });
            }}
          >
            Mijn locatie
          </button>
        </div>
        <button
          type="button"
          className={`${buttonClass} absolute bottom-3 left-3`}
          onClick={showOverview}
        >
          {route?.points.length ? "Toon hele route" : "Hele kaart"}
        </button>
        {holding ? (
          <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-cyan-950 px-4 py-2 text-sm text-cyan-100">
            Even vasthouden…
          </p>
        ) : null}
      </div>
      <footer className="shrink-0 space-y-2 border-t border-slate-700 bg-slate-950 px-4 py-3">
        <p role="status" className="text-sm text-cyan-200">
          {route
            ? navigationLabel(route)
            : "Kies je bestemming op de kaart of bij de bekende plekken."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="arena-map-place">
            Bekende plek
          </label>
          <select
            id="arena-map-place"
            className={`${buttonClass} min-w-0 max-w-full`}
            value=""
            onChange={(event) => {
              const landmark = data.index.landmarks.find(
                (place) => place.key === event.target.value,
              );
              if (landmark) {
                cancelPress();
                onDestination([
                  fromUnits(landmark.center[0]),
                  fromUnits(landmark.center[1]),
                ]);
              }
            }}
          >
            <option value="">Bekende plek kiezen</option>
            {data.index.landmarks.map((place) => (
              <option key={place.key} value={place.key}>
                {place.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={buttonClass}
            onClick={() => onDestination(view.center)}
          >
            Kies kaartmidden
          </button>
          {route ? (
            <button
              type="button"
              className={buttonClass}
              onClick={() => onDestination(null)}
            >
              Navigatie stoppen
            </button>
          ) : null}
          {route?.status === "navigating" ? (
            <button
              type="button"
              className={`${buttonClass} border-cyan-400 text-cyan-200`}
              onClick={onClose}
            >
              Volg route
            </button>
          ) : null}
        </div>
        <p id="map-instructions" className="text-xs text-slate-400">
          Sleep om te verplaatsen · +/− om te zoomen. Toetsenbord: pijltjes en
          Enter. Bestemmingen liggen op de dichtstbijzijnde straat. Het spel
          loopt door.
        </p>
        <p className="text-[10px] text-slate-500">© OpenStreetMap-bijdragers</p>
      </footer>
    </div>
  );
}
