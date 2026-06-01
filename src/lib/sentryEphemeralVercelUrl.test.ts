import { describe, expect, it } from "vitest";
import {
  hostnameFromUrlOrHost,
  isEphemeralVercelPreviewHostname,
  isEphemeralVercelPreviewUrl,
} from "./sentryEphemeralVercelUrl";

describe("isEphemeralVercelPreviewHostname", () => {
  it("matches Vercel git preview hostnames", () => {
    expect(
      isEphemeralVercelPreviewHostname(
        "h3-teamy-git-cursor-fix-produc-0cf5d4-guido-vermeulens-projects.vercel.app",
      ),
    ).toBe(true);
  });

  it("does not match production vercel.app host", () => {
    expect(isEphemeralVercelPreviewHostname("h3-teamy.vercel.app")).toBe(false);
  });

  it("does not match custom domains", () => {
    expect(isEphemeralVercelPreviewHostname("app.example.com")).toBe(false);
  });
});

describe("isEphemeralVercelPreviewUrl", () => {
  it("parses https URLs", () => {
    expect(
      isEphemeralVercelPreviewUrl(
        "https://h3-teamy-git-branch-abc123-team.vercel.app/login",
      ),
    ).toBe(true);
  });

  it("returns false for production URL", () => {
    expect(isEphemeralVercelPreviewUrl("https://h3-teamy.vercel.app")).toBe(
      false,
    );
  });
});

describe("hostnameFromUrlOrHost", () => {
  it("extracts host from bare hostname", () => {
    expect(hostnameFromUrlOrHost("h3-teamy.vercel.app")).toBe(
      "h3-teamy.vercel.app",
    );
  });
});
