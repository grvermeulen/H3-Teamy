import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppBar from "./AppBar";

const back = vi.fn();
const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back, push, replace }),
}));

describe("AppBar", () => {
  beforeEach(() => {
    back.mockReset();
    push.mockReset();
    replace.mockReset();
  });

  it("renders its title and back control", () => {
    render(<AppBar title="Wedstrijdverslag" />);

    expect(
      screen.getByRole("heading", { name: "Wedstrijdverslag" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terug" })).toBeInTheDocument();
  });

  it("replaces the detail route with its safe in-app fallback", () => {
    render(<AppBar title="Feedback" fallbackHref="/admin" />);

    fireEvent.click(screen.getByRole("button", { name: "Terug" }));

    expect(replace).toHaveBeenCalledWith("/admin");
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
