import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createArenaPlayer } from "@/lib/cityArena/sim/arena";
import ArenaDebugOverlay from "./ArenaDebugOverlay";

describe("ArenaDebugOverlay", () => {
  afterEach(() => {
    cleanup();
  });

  it("prints the metrics", () => {
    render(
      <ArenaDebugOverlay
        metrics={{
          fps: 58,
          frameP95Ms: 19.2,
          drawP95Ms: 5.1,
          simP95Ms: 0.4,
          samples: 120,
        }}
        chunks={{ chunks: 6, bytes: 12 * 1024 * 1024 }}
        tiles={9}
        camera={{ x: 2587.3, y: 1670.7, zoom: 6 }}
        player={createArenaPlayer([2588, 1671], 0)}
        routeMetres={412}
        entities={{ vehicles: 8, bullets: 2, effects: 3, violations: 0 }}
      />,
    );
    const panel = screen.getByTestId("arena-debug");
    expect(panel).toHaveTextContent("fps 58");
    expect(panel).toHaveTextContent("tekenen p95 5.1 ms");
    expect(panel).toHaveTextContent("blokken 6 (12.0 MB)");
    expect(panel).toHaveTextContent("tegels 9");
    expect(panel).toHaveTextContent("zoom 6");
    expect(panel).toHaveTextContent("route 412 m");
    expect(panel).toHaveTextContent(
      "auto's 8 · kogels 2 · effecten 3 · schendingen 0",
    );
  });
});
