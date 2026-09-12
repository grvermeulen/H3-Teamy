import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeathOverlay, { WASTED_ALT } from "./DeathOverlay";

describe("DeathOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("walks through slow motion, the artwork slam, the fade and black", () => {
    render(
      <DeathOverlay
        diedAtMs={Date.now()}
        reducedMotion={false}
        now={() => Date.now()}
      />,
    );
    const overlay = screen.getByTestId("death-overlay");
    expect(overlay).toHaveAttribute("data-stage", "slowmo");
    expect(screen.queryByAltText(WASTED_ALT)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(overlay).toHaveAttribute("data-stage", "art");
    const artwork = screen.getByAltText(WASTED_ALT);
    expect(artwork).toHaveAttribute("src", "/branding/wasted-screen.jpg");
    expect(artwork.className).toContain("arena-wasted-slam");
    act(() => {
      vi.advanceTimersByTime(2450);
    });
    expect(overlay).toHaveAttribute("data-stage", "fade");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(overlay).toHaveAttribute("data-stage", "black");
  });

  it("fades the artwork in instead of slamming under reduced motion", () => {
    render(
      <DeathOverlay
        diedAtMs={Date.now()}
        reducedMotion
        now={() => Date.now()}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByAltText(WASTED_ALT).className).toContain(
      "arena-wasted-fade",
    );
  });
});
