import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_TOAST_MS, HostToast } from "./HostToast";

describe("HostToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("says nothing about the first host: the lobby already names them", () => {
    render(<HostToast hostClientId="a" hostName="Noor" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces a new host for a few seconds, then goes quiet", () => {
    const { rerender } = render(<HostToast hostClientId="a" hostName="Noor" />);
    rerender(<HostToast hostClientId="b" hostName="Bram" />);
    expect(screen.getByRole("status")).toHaveTextContent("Nieuwe host: Bram");
    act(() => {
      vi.advanceTimersByTime(HOST_TOAST_MS);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not announce a host who merely changed their name", () => {
    const { rerender } = render(<HostToast hostClientId="a" hostName="Noor" />);
    rerender(<HostToast hostClientId="a" hostName="Noortje" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("names a new host the crew cannot name yet as unknown", () => {
    const { rerender } = render(<HostToast hostClientId="a" hostName="Noor" />);
    rerender(<HostToast hostClientId="b" hostName={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nieuwe host: Onbekend",
    );
  });
});
