import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ArenaLoadingScreen, { ATTRIBUTION_TEXT } from "./ArenaLoadingScreen";

describe("ArenaLoadingScreen", () => {
  it("shows progress, the attribution and hides a broken splash image", () => {
    render(<ArenaLoadingScreen loaded={3} total={9} failed={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Kaart laden… 3/9");
    expect(screen.getByText(ATTRIBUTION_TEXT)).toBeInTheDocument();
    const image = screen.getByTestId("game-splash-image");
    fireEvent.error(image);
    expect(screen.queryByTestId("game-splash-image")).toBeNull();
  });

  it("explains partial failures", () => {
    render(<ArenaLoadingScreen loaded={7} total={9} failed />);
    expect(
      screen.getByText("Kaart kon niet volledig laden"),
    ).toBeInTheDocument();
  });
});
