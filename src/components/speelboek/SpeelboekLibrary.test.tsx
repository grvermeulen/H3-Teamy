import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SpeelboekLibrary from "./SpeelboekLibrary";

const NOW = "2026-11-10T12:00:00Z";

describe("SpeelboekLibrary", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists drills grouped by category with a Nieuw section for recent additions", () => {
    render(<SpeelboekLibrary nowIso={NOW} />);

    expect(screen.getByRole("region", { name: "Nieuw" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Aanval" })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Verdediging" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Tip-in/ })[0]).toHaveAttribute(
      "href",
      "/speelboek/tip-in",
    );
  });

  it("filters by category chip", () => {
    render(<SpeelboekLibrary nowIso={NOW} />);

    fireEvent.click(screen.getByRole("button", { name: "Keeper" }));

    expect(screen.getByText("Geen oefeningen gevonden")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Techniek" }));

    expect(
      screen.queryByRole("region", { name: "Nieuw" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tip-in/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /4-2 man-meer/ }),
    ).not.toBeInTheDocument();
  });

  it("filters by search query", () => {
    render(<SpeelboekLibrary nowIso={NOW} />);

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Zoek in het speelboek" }),
      {
        target: { value: "zone" },
      },
    );

    expect(
      screen.getByRole("link", { name: /Zone 5 tegen 6/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Tip-in/ }),
    ).not.toBeInTheDocument();
  });
});
