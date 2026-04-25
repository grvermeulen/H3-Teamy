import { describe, it, expect } from "vitest";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  FeedbackCreateBodySchema,
  FeedbackStatusUpdateBodySchema,
} from "./feedback";

describe("FeedbackCreateBodySchema", () => {
  it("accepts a valid bug submission", () => {
    const out = FeedbackCreateBodySchema.parse({
      type: "BUG",
      title: "RSVP button broken",
      body: "When I click yes nothing happens.",
      route: "/",
      appVersion: "0.2.0",
    });
    expect(out.type).toBe("BUG");
    expect(out.title).toBe("RSVP button broken");
  });

  it("accepts an idea without optional fields", () => {
    const out = FeedbackCreateBodySchema.parse({
      type: "IDEA",
      title: "Notify 1h before training",
      body: "Push notification one hour before practice.",
    });
    expect(out.route).toBeUndefined();
    expect(out.appVersion).toBeUndefined();
  });

  it("rejects unknown type", () => {
    const r = FeedbackCreateBodySchema.safeParse({
      type: "QUESTION",
      title: "Hello there",
      body: "Why hello",
    });
    expect(r.success).toBe(false);
  });

  it("rejects too-short title", () => {
    const r = FeedbackCreateBodySchema.safeParse({
      type: "BUG",
      title: "Hi",
      body: "Long enough body string",
    });
    expect(r.success).toBe(false);
  });

  it("rejects too-long title", () => {
    const r = FeedbackCreateBodySchema.safeParse({
      type: "BUG",
      title: "x".repeat(121),
      body: "Long enough body",
    });
    expect(r.success).toBe(false);
  });

  it("rejects too-short body", () => {
    const r = FeedbackCreateBodySchema.safeParse({
      type: "BUG",
      title: "Valid title",
      body: "no",
    });
    expect(r.success).toBe(false);
  });

  it("rejects too-long body", () => {
    const r = FeedbackCreateBodySchema.safeParse({
      type: "BUG",
      title: "Valid title",
      body: "x".repeat(4001),
    });
    expect(r.success).toBe(false);
  });

  it("trims whitespace on title", () => {
    const out = FeedbackCreateBodySchema.parse({
      type: "BUG",
      title: "   Trim me   ",
      body: "Body that is long enough",
    });
    expect(out.title).toBe("Trim me");
  });
});

describe("FeedbackStatusUpdateBodySchema", () => {
  it("accepts each known status", () => {
    for (const status of FEEDBACK_STATUSES) {
      const r = FeedbackStatusUpdateBodySchema.safeParse({ status });
      expect(r.success).toBe(true);
    }
  });

  it("rejects unknown status", () => {
    const r = FeedbackStatusUpdateBodySchema.safeParse({ status: "WONTFIX" });
    expect(r.success).toBe(false);
  });
});

describe("constants", () => {
  it("exposes both feedback types", () => {
    expect(FEEDBACK_TYPES).toEqual(["BUG", "IDEA"]);
  });
});
