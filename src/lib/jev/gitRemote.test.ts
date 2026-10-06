import { describe, expect, it } from "vitest";
import { authenticatedRemoteUrl } from "./gitRemote";

describe("authenticatedRemoteUrl", () => {
  it("injects token for https github.com URLs", () => {
    const url = authenticatedRemoteUrl(
      "https://github.com/grvermeulen/H3-Teamy.git",
      "ghs_test",
    );
    expect(url).toBe(
      "https://x-access-token:ghs_test@github.com/grvermeulen/H3-Teamy.git",
    );
  });

  it("rejects evil host with github.com in the path", () => {
    const remote = "https://evil.com/github.com/owner/repo.git";
    expect(authenticatedRemoteUrl(remote, "token")).toBe(remote);
  });

  it("converts git@github.com SSH URLs", () => {
    expect(
      authenticatedRemoteUrl("git@github.com:owner/repo.git", "tok"),
    ).toBe("https://x-access-token:tok@github.com/owner/repo.git");
  });

  it("returns unchanged URL without token", () => {
    const remote = "https://github.com/o/r.git";
    expect(authenticatedRemoteUrl(remote)).toBe(remote);
  });
});
