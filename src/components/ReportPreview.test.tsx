import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom";
import ReportPreview from "./ReportPreview";

// Mock modalLock
vi.mock("../lib/modalLock", () => ({
  lockBodyForModal: vi.fn(),
}));

describe("ReportPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing if no report content", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ report: null }),
    } as Response);

    render(<ReportPreview eventId="123" />);

    // Wait for effect
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const button = screen.queryByText("Bekijk wedstrijd verslag");
    expect(button).not.toBeInTheDocument();
  });

  it("renders button if report exists", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ report: { content: "Test Report" } }),
    } as Response);

    render(<ReportPreview eventId="123" />);

    await waitFor(() =>
      expect(screen.getByText("Bekijk wedstrijd verslag")).toBeInTheDocument(),
    );
  });

  it("opens modal and shows content when clicked", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      json: () =>
        Promise.resolve({ report: { content: "Detailed Match Report" } }),
    } as Response);

    render(<ReportPreview eventId="123" />);

    // Wait for button
    await waitFor(() =>
      expect(screen.getByText("Bekijk wedstrijd verslag")).toBeInTheDocument(),
    );

    // Click button
    fireEvent.click(screen.getByText("Bekijk wedstrijd verslag"));

    // Check modal
    await waitFor(() =>
      expect(screen.getByText("Wedstrijd verslag")).toBeInTheDocument(),
    );
    expect(screen.getByText("Detailed Match Report")).toBeInTheDocument();
  });

  it("closes modal when close button clicked", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ report: { content: "Test" } }),
    } as Response);

    render(<ReportPreview eventId="123" />);

    // First wait for the button to appear
    await waitFor(() =>
      expect(screen.getByText("Bekijk wedstrijd verslag")).toBeInTheDocument(),
    );

    // Then click it once
    fireEvent.click(screen.getByText("Bekijk wedstrijd verslag"));

    expect(screen.getByText("Wedstrijd verslag")).toBeInTheDocument();

    const closeBtn = screen.getByLabelText("Close");
    fireEvent.click(closeBtn);

    expect(screen.queryByText("Wedstrijd verslag")).not.toBeInTheDocument();
  });

  it("refreshes content on report:updated event", async () => {
    // First fetch returns nothing
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ report: null }),
      } as Response)
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ report: { content: "New Content" } }),
      } as Response);

    render(<ReportPreview eventId="123" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText("Bekijk wedstrijd verslag"),
    ).not.toBeInTheDocument();

    // Trigger update event
    const event = new CustomEvent("report:updated", {
      detail: { eventId: "123" },
    });
    window.dispatchEvent(event);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Bekijk wedstrijd verslag")).toBeInTheDocument();
  });

  it("handles fetch errors gracefully", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue("Network Error");

    render(<ReportPreview eventId="123" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(
      screen.queryByText("Bekijk wedstrijd verslag"),
    ).not.toBeInTheDocument();
  });

  it("closes modal when clicking overlay", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ report: { content: "Test" } }),
    } as Response);

    render(<ReportPreview eventId="123" />);
    await waitFor(() =>
      fireEvent.click(screen.getByText("Bekijk wedstrijd verslag")),
    );

    // Find overlay and click it
    const overlay = document.querySelector(".modalOverlay");
    if (overlay) fireEvent.click(overlay);

    expect(screen.queryByText("Wedstrijd verslag")).not.toBeInTheDocument();
  });

  it("prevents click propagation from modal content", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ report: { content: "Test" } }),
    } as Response);

    render(<ReportPreview eventId="123" />);
    await waitFor(() =>
      fireEvent.click(screen.getByText("Bekijk wedstrijd verslag")),
    );

    const content = document.querySelector(".modalContent");
    if (content) fireEvent.click(content);

    // Should still be open
    expect(screen.getByText("Wedstrijd verslag")).toBeInTheDocument();
  });
});
