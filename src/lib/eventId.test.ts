import { describe, it, expect } from "vitest";
import { canonicalEventId, slugifyTitle } from "./eventId";

describe("eventId", () => {
  describe("slugifyTitle", () => {
    it("slugifies simple titles", () => {
      expect(slugifyTitle("Hello World")).toBe("hello-world");
    });

    it("removes special characters", () => {
      expect(slugifyTitle("Hello @ World!")).toBe("hello-world");
    });

    it("handles accents", () => {
      expect(slugifyTitle("Héllò Wörld")).toBe("hello-world");
    });

    it("trims dashes", () => {
      expect(slugifyTitle("-Hello-")).toBe("hello");
    });
  });

  describe("canonicalEventId", () => {
    it("generates ID from Date object", () => {
      // Use explicit timestamp with T00:00:00 to avoid UTC midnight rolling back in negative timezones
      const date = new Date("2023-10-05T12:00:00");
      expect(canonicalEventId("My Event", date)).toBe("20231005--my-event");
    });

    it("generates ID from date string", () => {
      expect(canonicalEventId("Training", "2023-01-01T12:00:00")).toBe(
        "20230101--training",
      );
    });

    it("handles empty title", () => {
      // Depending on implementation, might return just date or trailing dashes
      // Let's see what it does. Implementation: `${y}${m}${day}--${slug}`
      // slugify("") -> ""
      // Expect: "20230101--"
      expect(canonicalEventId("", "2023-01-01T12:00:00")).toBe("20230101--");
    });
  });
});
