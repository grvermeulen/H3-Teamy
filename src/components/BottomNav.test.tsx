import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSession } from "./SessionContext";
import BottomNav from "./BottomNav";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

vi.mock("./SessionContext", () => ({
  useSession: vi.fn(),
}));

describe("BottomNav", () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue("/");
  });

  it("keeps a mobile login entry point for anonymous users", () => {
    vi.mocked(useSession).mockReturnValue({
      loading: false,
      loggedIn: false,
      isTrainer: false,
      isAdmin: false,
      refresh: vi.fn(),
    });

    render(<BottomNav />);

    expect(screen.getByRole("link", { name: "Inloggen" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("links authenticated users to their profile", () => {
    vi.mocked(useSession).mockReturnValue({
      loading: false,
      loggedIn: true,
      isTrainer: false,
      isAdmin: false,
      refresh: vi.fn(),
    });

    render(<BottomNav />);

    expect(screen.getByRole("link", { name: "Profiel" })).toHaveAttribute(
      "href",
      "/profile",
    );
  });
});
