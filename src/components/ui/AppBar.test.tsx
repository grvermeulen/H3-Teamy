import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppBar from "./AppBar";

const back = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back, push }),
}));

describe("AppBar", () => {
  beforeEach(() => {
    back.mockReset();
    push.mockReset();
  });

  it("renders its title and back control", () => {
    render(<AppBar title="Wedstrijdverslag" />);

    expect(
      screen.getByRole("heading", { name: "Wedstrijdverslag" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terug" })).toBeInTheDocument();
  });

  it("uses the fallback route without browser history", () => {
    Object.defineProperty(window.history, "length", {
      configurable: true,
      value: 1,
    });
    render(<AppBar title="Feedback" fallbackHref="/admin" />);

    fireEvent.click(screen.getByRole("button", { name: "Terug" }));

    expect(push).toHaveBeenCalledWith("/admin");
    expect(back).not.toHaveBeenCalled();
  });
});
