import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveArenaSettings } from "@/lib/cityArena/storage";
import type { ArenaEntry } from "./arenaEntry";
import { ArenaModePage } from "./ArenaModePage";

vi.mock("../SessionContext", () => ({
  useSession: () => ({ loading: false, loggedIn: true }),
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function EntryStub({ entry }: { entry: ArenaEntry }) {
      return <div data-testid="entry">{JSON.stringify(entry)}</div>;
    },
}));

describe("location selection across arena modes", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it.each(["player", "display", "controller", "hybrid"] as const)(
    "creates a %s room in the chosen location",
    (role) => {
      saveArenaSettings({ lastZone: "bennekom" });
      render(<ArenaModePage defaultRole={role} />);
      expect(screen.getByRole("radio", { name: /Bennekom/ })).toBeChecked();
      fireEvent.click(screen.getByRole("radio", { name: /WUR-campus/ }));
      fireEvent.click(
        screen.getByRole("button", { name: "Potje openen in WUR-campus" }),
      );
      expect(JSON.parse(screen.getByTestId("entry").textContent!)).toEqual({
        kind: "new",
        zone: "campus",
        role,
      });
    },
  );

  it("keeps joining an existing code separate from creating a new location", () => {
    render(<ArenaModePage defaultRole="player" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Kamercode" }), {
      target: { value: "ABC234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Meedoen" }));
    expect(JSON.parse(screen.getByTestId("entry").textContent!)).toMatchObject({
      kind: "join",
      roomCode: "ABC234",
      role: "player",
    });
  });
});
