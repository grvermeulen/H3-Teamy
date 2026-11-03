import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRILLS } from "../../lib/speelboek/drills";
import { drillToInput, newDrillInput } from "../../lib/speelboek/editor";
import DrillEditor from "./DrillEditor";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));
vi.mock("./PoolEditorCanvas", () => ({
  default: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect("p1")}>
      canvas: selecteer p1
    </button>
  ),
}));

const fetchMock = vi.fn();

describe("DrillEditor", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    push.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("blocks saving until the obvious fields are filled", async () => {
    render(<DrillEditor initial={newDrillInput()} counterparts={[]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Opslaan als concept" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Geef de oefening een titel.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds a step from the end positions and lets you edit a role for the selected player", () => {
    render(<DrillEditor initial={newDrillInput()} counterparts={[]} />);
    expect(screen.getByText("Stap 1 van 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /\+ Stap/ }));
    expect(screen.getByText("Stap 2 van 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Titel van de stap")).toHaveValue("Stap 2");

    fireEvent.click(
      screen.getByRole("button", { name: "canvas: selecteer p1" }),
    );
    expect(screen.getByTestId("player-panel")).toHaveTextContent(
      "1 · Vleugel rechts",
    );
    fireEvent.change(screen.getByLabelText("Rol in deze stap"), {
      target: { value: "Drijf naar de paal" },
    });
    expect(screen.getByLabelText("Rol in deze stap")).toHaveValue(
      "Drijf naar de paal",
    );

    fireEvent.click(screen.getByRole("button", { name: "Geen rol" }));
    expect(screen.getByTestId("player-panel")).toHaveTextContent("(geen rol)");
  });

  it("posts a new drill and navigates to it", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ drill: { id: "tip-in-2" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <DrillEditor
        initial={{ ...drillToInput(DRILLS[0], true), keyPoints: [] }}
        counterparts={[{ id: "zone-5-tegen-6", title: "Zone" }]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Let op/), {
      target: { value: "Eén\n\nTwee" },
    });
    fireEvent.change(screen.getByLabelText(/Tegenhanger/), {
      target: { value: "zone-5-tegen-6" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Opslaan en publiceren" }),
    );

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/speelboek/tip-in-2"),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/speelboek/drills");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      published: true,
      keyPoints: ["Eén", "Twee"],
      counterpartId: "zone-5-tegen-6",
    });
  });

  it("puts to the existing drill when editing and shows the server error", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Oefening niet gevonden" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <DrillEditor
        drillId="mijn-oefening"
        initial={drillToInput(DRILLS[0], false)}
        counterparts={[]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Opslaan als concept" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Oefening niet gevonden",
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/speelboek/drills/mijn-oefening",
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PUT");
    expect(
      screen.getByRole("button", { name: "Oefening verwijderen" }),
    ).toBeInTheDocument();
  });
});
