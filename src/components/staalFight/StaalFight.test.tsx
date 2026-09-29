import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StaalFight from "./StaalFight";

vi.mock("next/font/google", () => ({
  Bangers: () => ({
    className: "font-bangers",
    style: { fontFamily: "'Bangers'" },
  }),
  Press_Start_2P: () => ({
    className: "font-ps2p",
    style: { fontFamily: "'Press Start 2P'" },
  }),
}));

const player = {
  start: vi.fn(),
  stop: vi.fn(),
  renderAt: vi.fn(),
  setFonts: vi.fn(),
  setAudio: vi.fn(),
  warp: { realAt: (t: number) => t },
  totalReal: 60,
  onEnd: undefined as undefined | (() => void),
};
vi.mock("@/lib/staalFight/player", () => ({
  FightPlayer: vi.fn(function FightPlayer(o: { onEnd?: () => void }) {
    player.onEnd = o.onEnd;
    return player;
  }),
}));

const audio = {
  load: vi.fn(async () => undefined),
  setMuted: vi.fn(),
  close: vi.fn(),
  stopAll: vi.fn(),
};
vi.mock("@/lib/staalFight/audio", () => ({
  FightAudio: { create: vi.fn(() => audio) },
}));

describe("StaalFight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the poster frame with a start button and the controls", () => {
    render(<StaalFight />);
    expect(
      screen.getByRole("img", {
        name: /Staal vecht in arcadestijl tegen Trump/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "▶ Start het gevecht" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Geluid uit" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sluiten" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(player.renderAt).toHaveBeenCalled();
    expect(player.start).not.toHaveBeenCalled();
  });

  it("loads the sound on the first tap, hands it to the player and starts the fight", async () => {
    render(<StaalFight />);
    fireEvent.click(
      screen.getByRole("button", { name: "▶ Start het gevecht" }),
    );
    await waitFor(() => expect(player.start).toHaveBeenCalledTimes(1));
    expect(audio.load).toHaveBeenCalled();
    expect(player.setAudio).toHaveBeenCalledWith(audio);
    expect(
      screen.queryByRole("button", { name: /Start het gevecht/ }),
    ).toBeNull();
  });

  it("offers a replay and a way back when the fight is over", async () => {
    render(<StaalFight />);
    fireEvent.click(
      screen.getByRole("button", { name: "▶ Start het gevecht" }),
    );
    await waitFor(() => expect(player.start).toHaveBeenCalled());
    act(() => player.onEnd?.());
    expect(
      screen.getByRole("link", { name: "Terug naar Teamy" }),
    ).toHaveAttribute("href", "/");
    fireEvent.click(screen.getByRole("button", { name: "Nog een keer" }));
    await waitFor(() => expect(player.start).toHaveBeenCalledTimes(2));
    expect(audio.load).toHaveBeenCalledTimes(1);
  });

  it("mutes and unmutes the sound", async () => {
    render(<StaalFight />);
    fireEvent.click(
      screen.getByRole("button", { name: "▶ Start het gevecht" }),
    );
    await waitFor(() => expect(player.start).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Geluid uit" }));
    expect(audio.setMuted).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Geluid aan" }));
    expect(audio.setMuted).toHaveBeenLastCalledWith(false);
  });
});
