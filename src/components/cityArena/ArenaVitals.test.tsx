import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ArenaVitals, { HEALTH_LABEL } from "./ArenaVitals";

describe("ArenaVitals", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the health bar, the weapon with unlimited ammo and no speed on foot", () => {
    render(
      <ArenaVitals
        health={70}
        weapon="pistol"
        ammo={{ uzi: 60, shotgun: 8 }}
        speedMps={null}
      />,
    );
    expect(screen.getByLabelText(HEALTH_LABEL)).toHaveAttribute("value", "70");
    expect(screen.getByTestId("arena-weapon")).toHaveTextContent("Pistool ∞");
    expect(screen.queryByTestId("arena-speed")).toBeNull();
  });

  it("shows rounds left and the speed in km/u while driving", () => {
    render(
      <ArenaVitals
        health={20}
        weapon="uzi"
        ammo={{ uzi: 42, shotgun: 8 }}
        speedMps={12}
      />,
    );
    expect(screen.getByTestId("arena-weapon")).toHaveTextContent("Uzi 42");
    expect(screen.getByTestId("arena-speed")).toHaveTextContent("43 km/u");
    expect(screen.getByLabelText(HEALTH_LABEL).className).toContain(
      "animate-pulse",
    );
  });
});
