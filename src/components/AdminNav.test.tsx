import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminNav from "./AdminNav";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));

describe("AdminNav", () => {
  beforeEach(() => vi.mocked(usePathname).mockReturnValue("/admin"));

  it("marks the users tab active on the admin index", () => {
    render(<AdminNav />);
    expect(screen.getByRole("link", { name: "Gebruikers" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks feedback active on nested feedback routes", () => {
    vi.mocked(usePathname).mockReturnValue("/admin/feedback");
    render(<AdminNav />);
    expect(screen.getByRole("link", { name: "Feedback" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
