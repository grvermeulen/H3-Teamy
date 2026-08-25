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

  it("does not report Chromium Failed to fetch for /api/whats-new (benign transient)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    render(<WhatsNewTour />);
    await vi.waitFor(
      () => {
        expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
      },
      { timeout: 500 },
    );
  });

  it("does not report Firefox NetworkError for /api/whats-new (benign transient)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(
      new DOMException("A network error occurred.", "NetworkError"),
    );
    render(<WhatsNewTour />);
    await vi.waitFor(
      () => {
        expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
      },
      { timeout: 500 },
    );
  });

  it("reports to Sentry when /api/whats-new fetch rejects with an unexpected error", async () => {
    const err = new TypeError("Unexpected fetch failure");
    vi.spyOn(global, "fetch").mockRejectedValue(err);
    render(<WhatsNewTour />);
    await waitFor(() => {
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(err, {
      tags: { clientFetch: "whats-new-tour" },
    });
  });

  it("reports to Sentry when /api/whats-new returns invalid JSON on 200", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    render(<WhatsNewTour />);
    await waitFor(() => {
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(SyntaxError),
      { tags: { clientFetch: "whats-new-tour" } },
    );
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
