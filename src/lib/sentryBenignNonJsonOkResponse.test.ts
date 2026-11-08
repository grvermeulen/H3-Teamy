import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { NON_JSON_OK_RESPONSE_SYNTAX_MESSAGE } from "./benignNonJsonOkResponse";
import {
  isBenignNonJsonOkResponseSentryIssueTitle,
  shouldDropBenignNonJsonOkResponseNoiseForSentry,
} from "./sentryBenignNonJsonOkResponse";

describe("shouldDropBenignNonJsonOkResponseNoiseForSentry", () => {
  it("drops SyntaxError on ephemeral Vercel preview URLs (JAVASCRIPT-NEXTJS-5H)", () => {
    const error = new SyntaxError(NON_JSON_OK_RESPONSE_SYNTAX_MESSAGE);
    const event = {
      request: {
        url: "https://h3-teamy-git-fix-main-guido-vermeulens-projects.vercel.app/",
      },
    } as ErrorEvent;
    const hint: EventHint = { originalException: error };
    expect(shouldDropBenignNonJsonOkResponseNoiseForSentry(event, hint)).toBe(
      true,
    );
  });

  it("keeps production SyntaxError events", () => {
    const error = new SyntaxError(NON_JSON_OK_RESPONSE_SYNTAX_MESSAGE);
    const event = {
      environment: "production",
      request: { url: "https://heren-3-de-rijn.com/" },
    } as ErrorEvent;
    const hint: EventHint = { originalException: error };
    expect(shouldDropBenignNonJsonOkResponseNoiseForSentry(event, hint)).toBe(
      false,
    );
  });

  it("ignores unrelated errors", () => {
    const hint: EventHint = { originalException: new TypeError("other") };
    expect(
      shouldDropBenignNonJsonOkResponseNoiseForSentry({} as ErrorEvent, hint),
    ).toBe(false);
  });
});

describe("isBenignNonJsonOkResponseSentryIssueTitle", () => {
  it("matches the grouped issue title", () => {
    expect(
      isBenignNonJsonOkResponseSentryIssueTitle(
        "SyntaxError: Response body is not valid JSON",
      ),
    ).toBe(true);
  });
});
