import { beforeEach, describe, expect, it, vi } from "vitest";
import { getReport } from "../../../lib/kv";
import { generateMetadata } from "./page";

vi.mock("../../../lib/kv", () => ({
  getReport: vi.fn(),
}));

describe("report page metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the report's opening in a shared link's preview", async () => {
    vi.mocked(getReport).mockResolvedValue({
      content: "De Rijn Heren 3 won met 7-5.",
      createdAt: "2026-11-01T12:00:00.000Z",
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ eventId: "evt-1" }),
    });

    expect(getReport).toHaveBeenCalledWith("evt-1");
    expect(metadata.title).toBe("Wedstrijdverslag De Rijn Heren 3");
    expect(metadata.description).toBe("De Rijn Heren 3 won met 7-5.");
  });

  it("falls back to the site's metadata when there is no report", async () => {
    vi.mocked(getReport).mockResolvedValue(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ eventId: "evt-missing" }),
    });

    expect(metadata).toEqual({});
  });
});
