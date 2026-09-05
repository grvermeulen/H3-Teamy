import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServiceWorkerRegistration from "./ServiceWorkerRegistration";
import { setupServiceWorker } from "../lib/serviceWorkerRegistration";

vi.mock("../lib/serviceWorkerRegistration", () => ({
  setupServiceWorker: vi.fn(),
}));

describe("ServiceWorkerRegistration", () => {
  const cleanup = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setupServiceWorker).mockReturnValue(cleanup);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("applies the production policy for a production build and renders nothing", () => {
    vi.stubEnv("NODE_ENV", "production");

    const { container } = render(<ServiceWorkerRegistration />);

    expect(container).toBeEmptyDOMElement();
    expect(setupServiceWorker).toHaveBeenCalledWith("production");
  });

  it("passes a non-production NODE_ENV through unchanged", () => {
    vi.stubEnv("NODE_ENV", "development");

    render(<ServiceWorkerRegistration />);

    expect(setupServiceWorker).toHaveBeenCalledWith("development");
  });

  it("cancels the pending policy on unmount", () => {
    const { unmount } = render(<ServiceWorkerRegistration />);
    expect(cleanup).not.toHaveBeenCalled();

    unmount();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
