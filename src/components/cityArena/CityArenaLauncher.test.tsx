import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyRoom } from "@/lib/cityArena/net/lobbyPresence";
import CityArenaLauncher from "./CityArenaLauncher";

const sessionState = {
  loading: false,
  loggedIn: true,
  isAdmin: false,
  isTrainer: false,
  refresh: async () => {},
};
vi.mock("../SessionContext", () => ({ useSession: () => sessionState }));

/** The overlay is stubbed so the launcher's own behaviour is what these tests measure. */
vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = ({
      entry,
      onClose,
    }: {
      entry: { kind: string; roomCode?: string; zone?: string };
      onClose: () => void;
    }): React.JSX.Element => (
      <div data-testid="overlay-stub">
        {`${entry.kind}:${entry.roomCode ?? entry.zone ?? ""}`}
        <button type="button" onClick={onClose}>
          dicht
        </button>
      </div>
    );
    return Stub;
  },
}));

/** A room in the lobby. */
function room(overrides: Partial<LobbyRoom> = {}): LobbyRoom {
  return {
    roomCode: "7K4M2Q",
    zone: "wageningen",
    hostName: "Noor",
    players: 3,
    phase: "lobby",
    ...overrides,
  };
}

/** Answers the rooms poll with `rooms`. */
function serveRooms(rooms: LobbyRoom[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ rooms }), { status: 200 })),
  );
}

describe("CityArenaLauncher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionState.loggedIn = true;
    serveRooms([]);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("names the game and pitches it", async () => {
    render(<CityArenaLauncher />);
    expect(screen.getByText("GTA H3")).toBeInTheDocument();
    expect(
      screen.getByText("Verken de stad samen en start een potje."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/geen potjes/i)).toBeInTheDocument(),
    );
  });

  it("counts the running potjes in the status strip", async () => {
    serveRooms([room(), room({ roomCode: "ABC234" })]);
    render(<CityArenaLauncher />);
    await waitFor(() =>
      expect(screen.getByText(/02 potjes actief/i)).toBeInTheDocument(),
    );
  });

  it("opens an active potje straight into its lobby", async () => {
    serveRooms([room()]);
    render(<CityArenaLauncher />);
    fireEvent.click(
      await screen.findByRole("button", { name: /meedoen · lobby openen/i }),
    );
    expect(screen.getByTestId("overlay-stub")).toHaveTextContent("join:7K4M2Q");
  });

  it("opens a fresh potje from Nieuw potje", async () => {
    render(<CityArenaLauncher />);
    fireEvent.click(await screen.findByRole("button", { name: "Nieuw potje" }));
    expect(screen.getByTestId("overlay-stub")).toHaveTextContent("new:");
  });

  it("opens code entry from Code invoeren", async () => {
    render(<CityArenaLauncher />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Code invoeren" }),
    );
    expect(screen.getByTestId("overlay-stub")).toHaveTextContent("code:");
  });

  it("closes the overlay again", async () => {
    render(<CityArenaLauncher />);
    fireEvent.click(await screen.findByRole("button", { name: "Nieuw potje" }));
    fireEvent.click(screen.getByText("dicht"));
    expect(screen.queryByTestId("overlay-stub")).toBeNull();
  });

  it("says the ranglijst is still coming rather than linking nowhere", async () => {
    render(<CityArenaLauncher />);
    const ranglijst = await screen.findByRole("button", {
      name: /ranglijst/i,
    });
    expect(ranglijst).toBeDisabled();
  });

  it("shows the empty state when nobody is hosting", async () => {
    render(<CityArenaLauncher />);
    await waitFor(() =>
      expect(screen.getByText("Geen actieve potjes")).toBeInTheDocument(),
    );
  });

  it("shows the same empty state when the lobby cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    render(<CityArenaLauncher />);
    await waitFor(() =>
      expect(screen.getByText("Geen actieve potjes")).toBeInTheDocument(),
    );
  });

  it("asks visitors to log in, and does not poll for them", () => {
    sessionState.loggedIn = false;
    render(<CityArenaLauncher />);
    expect(screen.queryByRole("button", { name: "Nieuw potje" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Log in om mee te doen" }),
    ).toHaveAttribute("href", expect.stringContaining("/login"));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(
      screen.getByText("Kaart © OpenStreetMap-bijdragers"),
    ).toBeInTheDocument();
  });
});
