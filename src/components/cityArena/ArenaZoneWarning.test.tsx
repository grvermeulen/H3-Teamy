import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ArenaZoneWarning from "./ArenaZoneWarning";

describe("ArenaZoneWarning", () => {
  it("uses a polite live region only while the zone countdown is active", () => {
    const { rerender } = render(
      <ArenaZoneWarning zoneWarning={false} secondsLeft={null} />,
    );
    expect(screen.queryByTestId("arena-zone-warning")).toBeNull();
    rerender(<ArenaZoneWarning zoneWarning secondsLeft={5} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Terug naar het strijdgebied! 5…",
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});
