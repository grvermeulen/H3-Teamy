import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import FeedbackFab from "./FeedbackFab";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/"),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("FeedbackFab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePathname).mockReturnValue("/");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the fab when the user is signed in and not on /login", async () => {
    vi.mocked(usePathname).mockReturnValue("/events");
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({ user: { id: "u1" } }),
    );

    render(<FeedbackFab />);

    await waitFor(() => {
      expect(screen.getByLabelText("Stuur feedback")).toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("hides the fab on /login even when the session has a user", async () => {
    vi.mocked(usePathname).mockReturnValue("/login");
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({ user: { id: "u1" } }),
    );

    render(<FeedbackFab />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByLabelText("Stuur feedback")).not.toBeInTheDocument();
  });

  it("hides the fab when there is no session user", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({}));

    render(<FeedbackFab />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByLabelText("Stuur feedback")).not.toBeInTheDocument();
  });

  it("captures session fetch failures in Sentry and hides the fab", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));

    render(<FeedbackFab />);

    await waitFor(() => {
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ component: "feedback-fab" }),
      }),
    );
    expect(screen.queryByLabelText("Stuur feedback")).not.toBeInTheDocument();
  });
});
