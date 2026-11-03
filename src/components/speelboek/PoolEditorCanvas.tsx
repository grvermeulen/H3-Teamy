"use client";

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DIAGRAM_HEIGHT,
  DIAGRAM_WIDTH,
  type DiagramFrame,
  type DiagramPoint,
} from "../../lib/schemas/speelboek";
import {
  MIN_ARROW_LENGTH,
  addArrow,
  hitTest,
  movePlayer,
  removePlayer,
  setBall,
  type EditorTool,
} from "../../lib/speelboek/editor";
import PoolDiagram from "./PoolDiagram";

type Props = {
  frame: DiagramFrame;
  labels: Record<string, string>;
  tool: EditorTool;
  selectedPlayerId: string | null;
  onFrameChange: (frame: DiagramFrame) => void;
  onSelect: (playerId: string | null) => void;
};

type Drag =
  | { kind: "player"; playerId: string }
  | { kind: "arrow"; playerId: string; to: DiagramPoint };

/**
 * Maps a pointer position to diagram coordinates. The SVG keeps the 2:1 viewBox
 * ratio (`xMidYMid meet`), so the drawing is centred inside the element box.
 */
export function toDiagramPoint(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): DiagramPoint {
  const scale = Math.min(
    rect.width / DIAGRAM_WIDTH,
    rect.height / DIAGRAM_HEIGHT,
  );
  const offsetX = (rect.width - DIAGRAM_WIDTH * scale) / 2;
  const offsetY = (rect.height - DIAGRAM_HEIGHT * scale) / 2;
  return [
    (clientX - rect.left - offsetX) / scale,
    (clientY - rect.top - offsetY) / scale,
  ];
}

/**
 * The drill editor's pool: renders {@link PoolDiagram} and layers a transparent
 * SVG on top that turns pointer gestures into frame edits — drag a cap to move it,
 * drag from a cap to draw a swim/pass/shot arrow, tap to select, give the ball or remove.
 */
export default function PoolEditorCanvas({
  frame,
  labels,
  tool,
  selectedPlayerId,
  onFrameChange,
  onSelect,
}: Props) {
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  function pointFromEvent(e: ReactPointerEvent<SVGSVGElement>): DiagramPoint {
    const el = overlayRef.current;
    const rect = el
      ? el.getBoundingClientRect()
      : { left: 0, top: 0, width: DIAGRAM_WIDTH, height: DIAGRAM_HEIGHT };
    return toDiagramPoint(rect, e.clientX, e.clientY);
  }

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>): void {
    const point = pointFromEvent(e);
    const hit = hitTest(frame, point);
    switch (tool) {
      case "SELECT":
        onSelect(hit);
        if (hit) {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ kind: "player", playerId: hit });
        }
        return;
      case "MOVE":
      case "PASS":
      case "SHOT":
        if (hit) {
          onSelect(hit);
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ kind: "arrow", playerId: hit, to: point });
        }
        return;
      case "BALL":
        if (hit) {
          onSelect(hit);
          onFrameChange(setBall(frame, hit));
        }
        return;
      case "DELETE":
        if (hit) {
          if (hit === selectedPlayerId) onSelect(null);
          onFrameChange(removePlayer(frame, hit));
        }
        return;
      default: {
        const exhaustive: never = tool;
        return exhaustive;
      }
    }
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>): void {
    if (!drag) return;
    const point = pointFromEvent(e);
    if (drag.kind === "player") {
      onFrameChange(movePlayer(frame, drag.playerId, point));
    } else {
      setDrag({ ...drag, to: point });
    }
  }

  function onPointerUp(e: ReactPointerEvent<SVGSVGElement>): void {
    if (!drag) return;
    if (
      drag.kind === "arrow" &&
      (tool === "MOVE" || tool === "PASS" || tool === "SHOT")
    ) {
      const from = frame.players.find((p) => p.id === drag.playerId);
      const to = pointFromEvent(e);
      if (
        from &&
        Math.hypot(to[0] - from.x, to[1] - from.y) >= MIN_ARROW_LENGTH
      ) {
        onFrameChange(
          addArrow(frame, { kind: tool, playerId: drag.playerId, to }),
        );
      }
    }
    setDrag(null);
  }

  const arrowPreview =
    drag?.kind === "arrow"
      ? frame.players.find((p) => p.id === drag.playerId)
      : undefined;

  return (
    <div className="speelboek-editor-canvas">
      <PoolDiagram
        frame={frame}
        labels={labels}
        selectedPlayerId={selectedPlayerId ?? undefined}
        title="Bewerkbaar diagram"
        className="speelboek-editor-static"
      />
      <svg
        ref={overlayRef}
        viewBox={`0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}`}
        xmlns="http://www.w3.org/2000/svg"
        className="speelboek-editor-overlay"
        data-tool={tool}
        role="application"
        aria-label="Spelers slepen en pijlen tekenen"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {arrowPreview && drag?.kind === "arrow" ? (
          <line
            x1={arrowPreview.x}
            y1={arrowPreview.y}
            x2={drag.to[0]}
            y2={drag.to[1]}
            stroke="#00d4ff"
            strokeWidth="2"
            strokeDasharray={tool === "PASS" ? "5 4" : undefined}
            data-arrow-preview=""
          />
        ) : null}
      </svg>
    </div>
  );
}
