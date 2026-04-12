import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { createInitialState } from "@/lib/spaceInvaders/game";
import * as SpaceStorage from "@/lib/spaceInvaders/storage";
import SpaceInvadersGame from "./SpaceInvadersGame";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("SpaceInvadersGame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    let rafCount = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback): number => {
        rafCount += 1;
        if (rafCount <= 12) {
          queueMicrotask(() => cb(performance.now() + rafCount * 16));
        }
        return rafCount;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const ctxStub = {
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      createLinearGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      shadowBlur: 0,
      shadowColor: "",
      font: "",
      textAlign: "",
      textBaseline: "",
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      closePath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      quadraticCurveTo: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctxStub as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders dialog overlay with HUD after mount", async () => {
    const onClose = vi.fn();
    render(
      <SpaceInvadersGame
        initialState={createInitialState()}
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Space Invaders" }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Score/)).toBeInTheDocument();
    expect(screen.getByText("Pauze")).toBeInTheDocument();
  });

  it("toggles pause label", async () => {
    render(
      <SpaceInvadersGame
        initialState={createInitialState()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Pauze"));
    expect(screen.getByText("Hervatten")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Hervatten"));
    expect(screen.getByText("Pauze")).toBeInTheDocument();
  });

  it("calls onClose when Sluiten clicked", async () => {
    const onClose = vi.fn();
    render(
      <SpaceInvadersGame
        initialState={createInitialState()}
        onClose={onClose}
      />,
    );
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Sluiten"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    render(
      <SpaceInvadersGame
        initialState={createInitialState()}
        onClose={onClose}
      />,
    );
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls saveGameToStorage and onClose when Opslaan en sluiten", async () => {
    const saveSpy = vi
      .spyOn(SpaceStorage, "saveGameToStorage")
      .mockImplementation(() => {});
    const onClose = vi.fn();
    render(
      <SpaceInvadersGame
        initialState={createInitialState()}
        onClose={onClose}
      />,
    );
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Opslaan en sluiten"));
    expect(saveSpy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("touch left button sets move input via pointer handlers", async () => {
    render(
      <SpaceInvadersGame
        initialState={createInitialState()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    const left = screen.getByText("← Links");
    fireEvent.pointerDown(left);
    fireEvent.pointerUp(left);
  });

  it("prevents context menu on the game overlay root", async () => {
    render(
      <SpaceInvadersGame
        initialState={createInitialState()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    const dialog = screen.getByRole("dialog", { name: "Space Invaders" });
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    dialog.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("registers gameover score once via addHighScore", async () => {
    const addSpy = vi.spyOn(SpaceStorage, "addHighScore").mockReturnValue([]);
    const clearSpy = vi
      .spyOn(SpaceStorage, "clearSave")
      .mockImplementation(() => {});
    const gameOver = {
      ...createInitialState(),
      status: "gameover" as const,
      lives: 0,
      score: 42,
      wave: 3,
    };
    render(<SpaceInvadersGame initialState={gameOver} onClose={vi.fn()} />);
    await waitFor(() => expect(addSpy).toHaveBeenCalled());
    expect(addSpy).toHaveBeenCalledWith(
      expect.objectContaining({ score: 42, wave: 3 }),
    );
    expect(clearSpy).toHaveBeenCalled();
  });
});
