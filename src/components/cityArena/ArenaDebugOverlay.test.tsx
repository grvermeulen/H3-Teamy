import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createArenaPlayer } from "@/lib/cityArena/sim/arena";
import ArenaDebugOverlay from "./ArenaDebugOverlay";
import { createFrameMetrics } from "@/lib/cityArena/debugMetrics";

describe("ArenaDebugOverlay", () => {
  afterEach(() => {
    cleanup();
  });

  it("survives partial metrics without throwing", () => {
    render(
      <ArenaDebugOverlay
        metrics={{
          ...createFrameMetrics().snapshot(),
          frameP95Ms: undefined as unknown as number,
          drawP95Ms: undefined as unknown as number,
        }}
        chunks={{ chunks: 1, bytes: 0 }}
        tiles={1}
        camera={{ x: 0, y: 0, zoom: 1 }}
        player={createArenaPlayer([0, 0], 0)}
        routeMetres={null}
        entities={{
          vehicles: 0,
          bullets: 0,
          effects: 0,
          peds: 0,
          cops: 0,
          traffic: 0,
          pickups: 0,
          wantedLevel: 0,
          zoneSecondsLeft: null,
          eventCount: 0,
          violations: 0,
        }}
      />,
    );
    expect(screen.getByTestId("arena-debug")).toHaveTextContent("frame p95 — ms");
  });

  it("prints the metrics", () => {
    render(
      <ArenaDebugOverlay
        metrics={{
          ...createFrameMetrics().snapshot(),
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
        entities={{
          vehicles: 8,
          bullets: 2,
          effects: 3,
          peds: 12,
          cops: 2,
          traffic: 5,
          pickups: 4,
          wantedLevel: 1,
          zoneSecondsLeft: 3,
          eventCount: 6,
          violations: 0,
        }}
      />,
    );
    const panel = screen.getByTestId("arena-debug");
    expect(panel).toHaveTextContent("fps 58");
    expect(panel).toHaveTextContent("tekenen p95 5.1 ms");
    expect(panel).toHaveTextContent("blokken 6 (12.0 MB)");
    expect(panel).toHaveTextContent("tegels 9");
    expect(panel).toHaveTextContent("zoom 6");
    expect(panel).toHaveTextContent("route 412 m");
    expect(panel).toHaveTextContent("verkeer 5");
    expect(panel).toHaveTextContent("voetgangers 12");
    expect(panel).toHaveTextContent("agenten 2");
    expect(panel).toHaveTextContent("pickups 4");
    expect(panel).toHaveTextContent("wanted 1");
    expect(panel).toHaveTextContent("zone 3s");
    expect(panel).toHaveTextContent("events 6");
    expect(panel).toHaveTextContent(
      "auto's 8 · kogels 2 · effecten 3 · schendingen 0",
    );
  });
});
