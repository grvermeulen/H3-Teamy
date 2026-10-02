import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CityArenaLaunchIcon,
  GTA_LOGO_PNG,
  GTA_LOGO_WEBP,
} from "./CityArenaLaunchIcon";

describe("CityArenaLaunchIcon", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the logo artwork at the given size", () => {
    render(<CityArenaLaunchIcon size={64} />);
    const img = screen.getByRole("img", { name: "GTA H3" });
    expect(img).toHaveAttribute("width", "64");
    expect(img).toHaveAttribute("height", "64");
    expect(img).toHaveAttribute("src", GTA_LOGO_PNG);
  });

  it("uses the documented webp source for the picture element", () => {
    const { container } = render(<CityArenaLaunchIcon />);
    const source = container.querySelector("source");
    expect(source).toHaveAttribute("srcset", GTA_LOGO_WEBP);
    expect(source).toHaveAttribute("type", "image/webp");
  });

  it("hides the icon from assistive tech when decorative", () => {
    render(<CityArenaLaunchIcon decorative />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("exposes an accessible name when not decorative", () => {
    render(<CityArenaLaunchIcon />);
    expect(screen.getByRole("img", { name: "GTA H3" })).toBeInTheDocument();
  });
});
