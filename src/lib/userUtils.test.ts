import { describe, it, expect } from "vitest";
import { displayName, hasUserIdentity } from "./userUtils";

describe("userUtils", () => {
  describe("displayName", () => {
    it("should return Full Name if both first and last name exist", () => {
      expect(
        displayName({ firstName: "John", lastName: "Doe", email: "j@d.com" }),
      ).toBe("John Doe");
    });

    it("should return First Name if only first name exists", () => {
      expect(displayName({ firstName: "John", email: "j@d.com" })).toBe("John");
    });

    it("should return email if no names exist", () => {
      expect(displayName({ email: "j@d.com" })).toBe("j@d.com");
    });

    it("should return empty string if nothing exists", () => {
      expect(displayName({})).toBe("");
    });
  });

  describe("hasUserIdentity", () => {
    it("should return true if any field is present", () => {
      expect(hasUserIdentity({ firstName: "John" })).toBe(true);
    });

    it("should return false if all fields are empty/null", () => {
      expect(hasUserIdentity({})).toBe(false);
      expect(
        hasUserIdentity({ firstName: "", lastName: null, email: "   " }),
      ).toBe(false);
    });
  });
});
