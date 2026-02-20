import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom"; // Direct import
import MvpVoteButton from "./MvpVoteButton";

// Mock Next.js dynamic import
vi.mock("next/dynamic", () => ({
  default: () => {
    const MockComponent = () => (
      <div data-testid="mock-mvp-voting-panel">MvpVotingPanel Content</div>
    );
    return MockComponent;
  },
}));

// Mock modalLock
vi.mock("../lib/modalLock", () => ({
  lockBodyForModal: vi.fn(),
}));

// Mock fetch
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ canClose: true, canReopen: true }),
  }),
) as unknown as typeof fetch;

describe("MvpVoteButton", () => {
  it("renders the vote button", async () => {
    render(<MvpVoteButton eventId="test-event-123" />);

    const button = screen.getByText("Stem op MVP");
    expect(button).toBeInTheDocument();

    // Wait for the effect to finish to avoid act warnings
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it("opens the modal when clicked", async () => {
    render(<MvpVoteButton eventId="test-event-123" />);

    // Wait for initial load
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const button = screen.getByText("Stem op MVP");
    fireEvent.click(button);

    const modalTitle = screen.getByText("MVP stemmen");
    expect(modalTitle).toBeInTheDocument();

    const panel = screen.getByTestId("mock-mvp-voting-panel");
    expect(panel).toBeInTheDocument();
  });

  it("closes the modal when close button is clicked", async () => {
    render(<MvpVoteButton eventId="test-event-123" />);

    // Wait for initial load
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    // Open modal
    fireEvent.click(screen.getByText("Stem op MVP"));
    expect(screen.getByText("MVP stemmen")).toBeInTheDocument();

    // Close modal
    const closeBtn = screen.getByLabelText("Close");
    fireEvent.click(closeBtn);

    expect(screen.queryByText("MVP stemmen")).not.toBeInTheDocument();
  });
});
