import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyRoom } from "@/lib/cityArena/net/lobbyPresence";
import { RoomList } from "./RoomList";

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

describe("RoomList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says the potjes are loading while the first fetch is in flight", () => {
    render(<RoomList state={{ status: "loading" }} onJoin={vi.fn()} />);
    expect(screen.getByText("Potjes laden…")).toBeInTheDocument();
  });

  it("says there are no potjes when nobody is hosting", () => {
    render(
      <RoomList state={{ status: "ready", rooms: [] }} onJoin={vi.fn()} />,
    );
    expect(screen.getByText("Geen actieve potjes")).toBeInTheDocument();
  });

  it("shows the same empty state when the lobby could not be read", () => {
    // A player cannot act on "the lobby is unreachable" any differently from "nothing is
    // running", and an error box on the home page would be noise. The failure is in Sentry.
    render(<RoomList state={{ status: "offline" }} onJoin={vi.fn()} />);
    expect(screen.getByText("Geen actieve potjes")).toBeInTheDocument();
  });

  it("features the first room with its zone, host and crew count", () => {
    render(
      <RoomList
        state={{ status: "ready", rooms: [room()] }}
        onJoin={vi.fn()}
      />,
    );
    expect(screen.getByText("Wageningen centrum")).toBeInTheDocument();
    expect(screen.getByText("Noor is host")).toBeInTheDocument();
    expect(screen.getByText("3 / 8 crew")).toBeInTheDocument();
    expect(screen.getByText("In lobby")).toBeInTheDocument();
  });

  it("labels a running match as bezig", () => {
    render(
      <RoomList
        state={{ status: "ready", rooms: [room({ phase: "playing" })] }}
        onJoin={vi.fn()}
      />,
    );
    expect(screen.getByText("Bezig")).toBeInTheDocument();
  });

  it("joins the room that was tapped", () => {
    const onJoin = vi.fn();
    render(
      <RoomList state={{ status: "ready", rooms: [room()] }} onJoin={onJoin} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /meedoen · lobby openen/i }),
    );
    expect(onJoin).toHaveBeenCalledWith(
      expect.objectContaining({ roomCode: "7K4M2Q" }),
    );
  });

  it("refuses a full room rather than opening it", () => {
    const onJoin = vi.fn();
    render(
      <RoomList
        state={{ status: "ready", rooms: [room({ players: 8 })] }}
        onJoin={onJoin}
      />,
    );
    const button = screen.getByRole("button", { name: /potje is vol/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onJoin).not.toHaveBeenCalled();
  });

  it("lists further rooms compactly, so a busy lobby does not push the buttons away", () => {
    const onJoin = vi.fn();
    render(
      <RoomList
        state={{
          status: "ready",
          rooms: [
            room(),
            room({
              roomCode: "ABC234",
              zone: "rhenen",
              players: 5,
              phase: "playing",
            }),
          ],
        }}
        onJoin={onJoin}
      />,
    );
    expect(screen.getByText("5 spelers · bezig")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Rhenen centrum"));
    expect(onJoin).toHaveBeenCalledWith(
      expect.objectContaining({ roomCode: "ABC234" }),
    );
  });
});
