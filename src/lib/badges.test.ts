import { describe, it, expect } from "vitest";
import { getBadgeForAttendance } from "./badges";

describe("getBadgeForAttendance", () => {
  it("returns Rookie for < 20%", () => {
    expect(getBadgeForAttendance(0).slug).toBe("rookie");
    expect(getBadgeForAttendance(19).slug).toBe("rookie");
  });

  it("returns Reliable Reserve for 20-39%", () => {
    expect(getBadgeForAttendance(20).slug).toBe("reliable-reserve");
    expect(getBadgeForAttendance(39).slug).toBe("reliable-reserve");
  });

  it("returns Average Jo for 40-59%", () => {
    expect(getBadgeForAttendance(40).slug).toBe("average");
    expect(getBadgeForAttendance(59).slug).toBe("average");
  });

  it("returns Veteran for 60-79%", () => {
    expect(getBadgeForAttendance(60).slug).toBe("veteran");
    expect(getBadgeForAttendance(79).slug).toBe("veteran");
  });

  it("returns Part of the furniture for >= 80%", () => {
    expect(getBadgeForAttendance(80).slug).toBe("furniture");
    expect(getBadgeForAttendance(100).slug).toBe("furniture");
    expect(getBadgeForAttendance(150).slug).toBe("furniture"); // Clamped
  });

  it("handles invalid input gracefully", () => {
    expect(getBadgeForAttendance(NaN).slug).toBe("rookie");
    expect(getBadgeForAttendance(-50).slug).toBe("rookie");
  });
});
