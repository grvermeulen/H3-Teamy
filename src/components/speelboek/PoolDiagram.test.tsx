import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DiagramFrame } from "../../lib/schemas/speelboek";
import PoolDiagram from "./PoolDiagram";

const frame: DiagramFrame = {
  attackColor: "WHITE",
  players: [
    { id: "gk", team: "GK", x: 150, y: 19 },
    { id: "d1", team: "DEF", x: 200, y: 60 },
    { id: "p1", team: "OFF", x: 250, y: 66 },
  ],
  arrows: [
    { kind: "MOVE", playerId: "p1", to: [180, 40], via: [220, 36] },
    { kind: "PASS", playerId: "p1", to: [150, 30] },
    { kind: "SHOT", playerId: "p1", to: [150, 12] },
    { kind: "MOVE", playerId: "missing", to: [10, 10] },
  ],
  ballPlayerId: "p1",
};

describe("PoolDiagram", () => {
  afterEach(() => {
    cleanup();
  });

  it("colours caps by team: attack white, defence blue, keeper red", () => {
    const { container } = render(
      <PoolDiagram frame={frame} labels={{ p1: "1" }} title="test" />,
    );
    const cap = (id: string) =>
      container.querySelector(`[data-player-id="${id}"] circle:last-of-type`);
    expect(cap("p1")).toHaveAttribute("fill", "#f3f6fb");
    expect(cap("d1")).toHaveAttribute("fill", "#2563eb");
    expect(cap("gk")).toHaveAttribute("fill", "#dc2626");
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-label",
      "test",
    );
  });

  it("swaps colours when the attack plays in blue", () => {
    const { container } = render(
      <PoolDiagram frame={{ ...frame, attackColor: "BLUE" }} />,
    );
    const cap = (id: string) =>
      container.querySelector(`[data-player-id="${id}"] circle:last-of-type`);
    expect(cap("p1")).toHaveAttribute("fill", "#2563eb");
    expect(cap("d1")).toHaveAttribute("fill", "#f3f6fb");
  });

  it("draws the ball next to the holder, labels only roster players and skips arrows from unknown players", () => {
    const { container } = render(
      <PoolDiagram frame={frame} labels={{ p1: "1" }} />,
    );
    const ball = container.querySelector("[data-ball]");
    expect(ball).toHaveAttribute("cx", "260");
    expect(ball).toHaveAttribute("cy", "57");
    expect(container.querySelectorAll("[data-player-id] text")).toHaveLength(1);
    expect(container.querySelectorAll("path[marker-end]")).toHaveLength(3);
  });

  it("highlights the selected player and hides distance labels in mini mode", () => {
    const { container, rerender } = render(
      <PoolDiagram frame={frame} selectedPlayerId="p1" />,
    );
    expect(
      container.querySelectorAll('[data-player-id="p1"] circle'),
    ).toHaveLength(2);
    expect(container.textContent).toContain("2m");
    rerender(<PoolDiagram frame={frame} mini />);
    expect(container.textContent).not.toContain("2m");
  });
});
