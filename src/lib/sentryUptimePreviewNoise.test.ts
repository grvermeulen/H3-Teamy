import { describe, expect, it } from "vitest";
import {
  extractUptimeUrlFromIssueTitle,
  isEphemeralPreviewUptimeDowntimeIssue,
} from "./sentryUptimePreviewNoise";

describe("extractUptimeUrlFromIssueTitle", () => {
  it("parses downtime issue titles", () => {
    expect(
      extractUptimeUrlFromIssueTitle(
        "Downtime detected for https://h3-teamy-git-cursor-fix-produc-0cf5d4-guido-vermeulens-projects.vercel.app",
      ),
    ).toBe(
      "https://h3-teamy-git-cursor-fix-produc-0cf5d4-guido-vermeulens-projects.vercel.app",
    );
  });

  it("returns undefined for unrelated titles", () => {
    expect(
      extractUptimeUrlFromIssueTitle("TypeError: x is not a function"),
    ).toBe(undefined);
  });
});

describe("isEphemeralPreviewUptimeDowntimeIssue", () => {
  it("flags preview uptime downtime (JAVASCRIPT-NEXTJS-1R shape)", () => {
    expect(
      isEphemeralPreviewUptimeDowntimeIssue(
        "Downtime detected for https://h3-teamy-git-cursor-fix-produc-0cf5d4-guido-vermeulens-projects.vercel.app",
      ),
    ).toBe(true);
  });

  it("does not flag production downtime titles", () => {
    expect(
      isEphemeralPreviewUptimeDowntimeIssue(
        "Downtime detected for https://h3-teamy.vercel.app",
      ),
    ).toBe(false);
  });
});
