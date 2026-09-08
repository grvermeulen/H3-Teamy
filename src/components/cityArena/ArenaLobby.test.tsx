import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrewMember } from "./ArenaLobby";
import { ArenaLobby } from "./ArenaLobby";

/** One crew member. */
function member(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    clientId: "a",
    seat: 0,
    name: "Noor",
    isHost: false,
    isYou: false,
    ...overrides,
  };
}

/** The lobby with sensible defaults, overridable per test. */
function renderLobby(
  props: Partial<React.ComponentProps<typeof ArenaLobby>> = {},
) {
  const handlers = {
    onStart: vi.fn(),
    onEnterCode: vi.fn(),
    onLeave: vi.fn(),
  };
  render(
    <ArenaLobby
      roomCode="7K4M2Q"
      zone="wageningen"
      crew={[member({ clientId: "me", isYou: true, isHost: true })]}
      connection="connected"
      isHost
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("ArenaLobby", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it("names the room and the zone", () => {
    renderLobby();
    expect(screen.getByText("Room 7K4M2Q · Lobby")).toBeInTheDocument();
    expect(screen.getByText("Wageningen centrum")).toBeInTheDocument();
  });

  it("shows the crew count against the capacity", () => {
    renderLobby({
      crew: [
        member({ clientId: "me", isYou: true, isHost: true }),
        member({ clientId: "b", seat: 1, name: "Sam" }),
      ],
    });
    expect(screen.getByText("2 / 8")).toBeInTheDocument();
  });

  it("labels you as JIJ and names everyone else", () => {
    renderLobby({
      crew: [
        member({ clientId: "me", name: "Guido", isYou: true, isHost: true }),
        member({ clientId: "b", seat: 1, name: "Sam" }),
      ],
    });
    expect(screen.getByText("Jij")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.queryByText("Guido")).not.toBeInTheDocument();
  });

  it("marks the host and everyone else as online", () => {
    renderLobby({
      crew: [
        member({ clientId: "me", isYou: true, isHost: true }),
        member({ clientId: "b", seat: 1, name: "Sam" }),
      ],
    });
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("tells the player the city keeps running while they wait", () => {
    renderLobby();
    expect(
      screen.getByText(/de stad blijft actief terwijl je wacht/i),
    ).toBeInTheDocument();
  });

  it("offers Oefenen when the host is alone", () => {
    renderLobby();
    expect(screen.getByRole("button", { name: "Oefenen" })).toBeInTheDocument();
  });

  it("offers Start potje once someone else has joined", () => {
    renderLobby({
      crew: [
        member({ clientId: "me", isYou: true, isHost: true }),
        member({ clientId: "b", seat: 1, name: "Sam" }),
      ],
    });
    expect(
      screen.getByRole("button", { name: "Start potje" }),
    ).toBeInTheDocument();
  });

  it("says why a non-host cannot start, rather than showing a dead button", () => {
    renderLobby({ isHost: false });
    expect(
      screen.getByText("Alleen de host kan het potje starten."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /start potje|oefenen/i }),
    ).not.toBeInTheDocument();
  });

  it("starts, leaves and opens code entry through its handlers", () => {
    const handlers = renderLobby();
    fireEvent.click(screen.getByRole("button", { name: "Oefenen" }));
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Potje verlaten" }));
    expect(handlers.onLeave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Code invoeren" }));
    expect(handlers.onEnterCode).toHaveBeenCalledTimes(1);
  });

  it("shows the connection state", () => {
    renderLobby();
    expect(screen.getByText("Verbonden")).toBeInTheDocument();
  });

  it("shows a reconnecting state when the connection drops", () => {
    renderLobby({ connection: "suspended" });
    expect(screen.getByText("Verbinden…")).toBeInTheDocument();
    expect(screen.queryByText("Verbonden")).not.toBeInTheDocument();
  });

  it("credits OpenStreetMap", () => {
    renderLobby();
    expect(screen.getByText(/openstreetmap/i)).toBeInTheDocument();
  });
});
