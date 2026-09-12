import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ArenaBeerPrompt from "./ArenaBeerPrompt";

describe("ArenaBeerPrompt", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a polite live prompt only at the tap, naming the key or the button", () => {
    const { rerender } = render(
      <ArenaBeerPrompt canOrderBeer={false} showTouch={false} />,
    );
    expect(screen.queryByTestId("arena-beer-prompt")).toBeNull();
    rerender(<ArenaBeerPrompt canOrderBeer showTouch={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Brouwerij Klein Zwitserland: druk op E voor een biertje",
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    rerender(<ArenaBeerPrompt canOrderBeer showTouch />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "tik op Biertje voor een biertje",
    );
  });
});
