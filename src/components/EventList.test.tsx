import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventList from "./EventList";

const sessionState = {
  loading: false,
  loggedIn: false,
  isAdmin: false,
  isTrainer: false,
  refresh: async () => {},
};
vi.mock("./SessionContext", () => ({ useSession: () => sessionState }));

vi.mock("./spaceInvaders/SpaceInvadersLauncher", () => ({
  default: () => <div data-testid="space-invaders-launcher" />,
}));

vi.mock("./cityArena/CityArenaLauncher", () => ({
  default: () => <div data-testid="city-arena-launcher" />,
}));

describe("EventList launcher gating", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the Space Invaders card and hides the GTA H3 card by default", async () => {
    render(<EventList events={[]} />);

    // `findBy` awaits EventList's auth-gated load effect so the update isn't left dangling
    // outside of act().
    expect(
      await screen.findByTestId("space-invaders-launcher"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("city-arena-launcher")).toBeNull();
  });

  it("shows the GTA H3 card when the feature is enabled", async () => {
    render(<EventList events={[]} gtaH3Enabled />);

    expect(
      await screen.findByTestId("space-invaders-launcher"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("city-arena-launcher")).toBeInTheDocument();
  });
});
