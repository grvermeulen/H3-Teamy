import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import FeatureToggles from "./FeatureToggles";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

describe("FeatureToggles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading state before the flags arrive", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<FeatureToggles />);

    expect(screen.getByText("Functies laden…")).toBeInTheDocument();
  });

  it("renders the current state once loaded", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ flags: { gtaH3Launcher: true } }),
    );

    render(<FeatureToggles />);

    const toggle = await screen.findByRole("switch", {
      name: "GTA H3 spel tonen",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/features",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("sends the PATCH body when toggled and updates optimistically", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ flags: { gtaH3Launcher: false } }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ flags: { gtaH3Launcher: true } }),
    );

    render(<FeatureToggles />);
    const toggle = await screen.findByRole("switch", {
      name: "GTA H3 spel tonen",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/features",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ key: "gtaH3Launcher", enabled: true }),
      }),
    );
  });

  it("reverts and shows the Dutch error when saving fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ flags: { gtaH3Launcher: false } }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, false));

    render(<FeatureToggles />);
    const toggle = await screen.findByRole("switch", {
      name: "GTA H3 spel tonen",
    });

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(
        screen.getByText("Opslaan mislukt, probeer het opnieuw"),
      ).toBeInTheDocument(),
    );
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("reports to Sentry and stays in the loading state when the initial load rejects", async () => {
    const error = new Error("network down");
    fetchMock.mockRejectedValueOnce(error);

    render(<FeatureToggles />);

    await waitFor(() =>
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          tags: { area: "admin", kind: "feature-flag-read" },
        }),
      ),
    );
    expect(screen.getByText("Functies laden…")).toBeInTheDocument();
  });

  it("reports to Sentry, reverts and shows the Dutch error when the PATCH request throws", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ flags: { gtaH3Launcher: false } }),
    );
    const error = new Error("network down");
    fetchMock.mockRejectedValueOnce(error);

    render(<FeatureToggles />);
    const toggle = await screen.findByRole("switch", {
      name: "GTA H3 spel tonen",
    });

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          tags: { area: "admin", kind: "feature-flag-write" },
        }),
      ),
    );
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("Opslaan mislukt, probeer het opnieuw"),
    ).toBeInTheDocument();
  });
});
