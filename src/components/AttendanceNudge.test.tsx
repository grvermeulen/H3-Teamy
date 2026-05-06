import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AttendanceNudge from "./AttendanceNudge";

const fetchJsonIfOkOr = vi.fn();
vi.mock("../lib/safeClientJson", () => ({
  fetchJsonIfOkOr: (...args: unknown[]) => fetchJsonIfOkOr(...args),
}));

describe("AttendanceNudge", () => {
  beforeEach(() => {
    fetchJsonIfOkOr.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when the API returns null", async () => {
    fetchJsonIfOkOr.mockResolvedValue({ nudge: null });
    const { container } = render(<AttendanceNudge />);
    await waitFor(() =>
      expect(fetchJsonIfOkOr).toHaveBeenCalledWith(
        "/api/training/nudge",
        expect.any(Object),
        "attendance-nudge",
      ),
    );
    // Component returns null after the fetch resolves with no nudge.
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("renders an encourage nudge with the AI message", async () => {
    fetchJsonIfOkOr.mockResolvedValue({
      nudge: {
        tone: "encourage",
        message: "Druk gehad? De bak ligt klaar.",
      },
    });
    render(<AttendanceNudge />);
    await screen.findByTestId("attendance-nudge-encourage");
    expect(
      screen.getByText("Druk gehad? De bak ligt klaar."),
    ).toBeInTheDocument();
  });

  it("renders a cheer nudge with the AI message", async () => {
    fetchJsonIfOkOr.mockResolvedValue({
      nudge: {
        tone: "cheer",
        message: "Twee weken full house — top.",
      },
    });
    render(<AttendanceNudge />);
    await screen.findByTestId("attendance-nudge-cheer");
    expect(
      screen.getByText("Twee weken full house — top."),
    ).toBeInTheDocument();
    expect(screen.getByText("Top!")).toBeInTheDocument();
  });

  it("renders nothing when the fetch helper returns null", async () => {
    fetchJsonIfOkOr.mockResolvedValue(null);
    const { container } = render(<AttendanceNudge />);
    await waitFor(() => expect(fetchJsonIfOkOr).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
