import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectionBanner, ConnectionDot } from "./ConnectionBanner";

describe("ConnectionBanner", () => {
  it("shows nothing while connected, so the strip stays meaningful", () => {
    const { container } = render(<ConnectionBanner state="connected" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says it is reconnecting when the connection is suspended", () => {
    render(<ConnectionBanner state="suspended" />);
    expect(
      screen.getByText("Verbinding verbroken… opnieuw verbinden"),
    ).toBeInTheDocument();
  });

  it("says to try later when the connection failed", () => {
    render(<ConnectionBanner state="failed" />);
    expect(
      screen.getByText("Kon geen verbinding maken, probeer het later opnieuw"),
    ).toBeInTheDocument();
  });

  it("announces itself politely rather than interrupting", () => {
    render(<ConnectionBanner state="failed" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});

describe("ConnectionDot", () => {
  it("reads VERBONDEN when connected", () => {
    render(<ConnectionDot state="connected" />);
    expect(screen.getByText("Verbonden")).toBeInTheDocument();
  });

  it("reads as connecting for every other state", () => {
    for (const state of ["connecting", "suspended", "failed"] as const) {
      const { unmount } = render(<ConnectionDot state={state} />);
      expect(screen.getByText("Verbinden…")).toBeInTheDocument();
      unmount();
    }
  });
});
