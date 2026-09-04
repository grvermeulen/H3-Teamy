import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARENA_SETTINGS_KEY } from "@/lib/cityArena/storage";
import CityArenaLauncher from "./CityArenaLauncher";

const sessionState = {
  loading: false,
  loggedIn: true,
  isAdmin: false,
  isTrainer: false,
  refresh: async () => {},
};
vi.mock("../SessionContext", () => ({ useSession: () => sessionState }));
vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = ({
      zone,
      onClose,
    }: {
      zone: string;
      onClose: () => void;
    }): React.JSX.Element => (
      <div data-testid="overlay-stub">
        {zone}
        <button type="button" onClick={onClose}>
          dicht
        </button>
      </div>
    );
    return Stub;
  },
}));

describe("CityArenaLauncher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionState.loggedIn = true;
  });

  it("offers the zone choice and opens the overlay for a logged-in member, remembering the zone", () => {
    render(<CityArenaLauncher />);
    expect(screen.getByText("Stadsstrijd")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Startpunt"), {
      target: { value: "rhenen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Spelen" }));
    expect(screen.getByTestId("overlay-stub")).toHaveTextContent("rhenen");
    expect(
      JSON.parse(localStorage.getItem(ARENA_SETTINGS_KEY) ?? "{}"),
    ).toEqual({ lastZone: "rhenen" });
    fireEvent.click(screen.getByText("dicht"));
    expect(screen.queryByTestId("overlay-stub")).toBeNull();
  });

  it("asks visitors to log in", () => {
    sessionState.loggedIn = false;
    render(<CityArenaLauncher />);
    expect(screen.queryByRole("button", { name: "Spelen" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Log in om mee te doen" }),
    ).toHaveAttribute("href", expect.stringContaining("/login"));
    expect(
      screen.getByText("Kaart © OpenStreetMap-bijdragers"),
    ).toBeInTheDocument();
  });
});
