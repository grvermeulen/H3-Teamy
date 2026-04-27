import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import WhatsNewTour from "./WhatsNewTour";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("WhatsNewTour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("shows tour when API returns show with payload", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        show: true,
        version: "0.2.0",
        payload: {
          title: "Wat is er nieuw",
          steps: [{ title: "Stap één", body: "Tekst" }],
        },
      }),
    );
    render(<WhatsNewTour />);
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText("Stap één")).toBeInTheDocument();
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("reports to Sentry when /api/whats-new fetch rejects with a real network error", async () => {
    const err = new TypeError("Failed to fetch");
    vi.spyOn(global, "fetch").mockRejectedValue(err);
    render(<WhatsNewTour />);
    await waitFor(() => {
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(err, {
      tags: { clientFetch: "whats-new-tour" },
    });
  });

  it("does not report to Sentry when unmounted before /api/whats-new resolves", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(global, "fetch").mockReturnValue(fetchPromise);
    const { unmount } = render(<WhatsNewTour />);
    unmount();
    resolveFetch!(
      jsonResponse({
        show: true,
        version: "0.2.0",
        payload: {
          title: "Wat is er nieuw",
          steps: [{ title: "Te laat", body: "x" }],
        },
      }),
    );
    await vi.waitFor(
      () => {
        expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
      },
      { timeout: 500 },
    );
  });
});
