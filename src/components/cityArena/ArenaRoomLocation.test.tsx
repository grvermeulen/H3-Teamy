import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ArenaRoomLocation } from "./ArenaRoomLocation";

afterEach(() => {
  cleanup();
});

it("explains the room location and offers an explicit leave-and-choose action", () => {
  const onNewGame = vi.fn();
  render(<ArenaRoomLocation zone="campus" onNewGame={onNewGame} />);
  expect(screen.getByText("Startlocatie: WUR-campus")).toBeInTheDocument();
  expect(screen.getByText(/staat vast voor deze kamer/)).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Verlaten en andere locatie kiezen" }),
  );
  expect(onNewGame).toHaveBeenCalledTimes(1);
});

it("prevents duplicate leave requests while the old room is closing", () => {
  const onNewGame = vi.fn();
  render(<ArenaRoomLocation zone="campus" onNewGame={onNewGame} leaving />);
  const button = screen.getByRole("button", { name: "Potje verlaten…" });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(onNewGame).not.toHaveBeenCalled();
});
