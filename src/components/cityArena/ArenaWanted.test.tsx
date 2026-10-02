import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ArenaWanted from "./ArenaWanted";

describe("ArenaWanted", () => {
  it("renders accessible Dutch labels at the 0 and 3 star boundaries", () => {
    const { rerender } = render(<ArenaWanted wantedLevel={0} />);
    expect(screen.getByLabelText("Gezocht: 0 sterren")).toBeInTheDocument();
    rerender(<ArenaWanted wantedLevel={3} />);
    expect(screen.getByLabelText("Gezocht: 3 sterren")).toBeInTheDocument();
    expect(screen.getByText("★★★")).toHaveAttribute("aria-hidden", "true");
  });
});
